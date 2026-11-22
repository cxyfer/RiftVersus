# RiftVersus 重構規格：Docker image 部署、SQLite 資料維護與前端 UI 重設計

- Date: 2026-11-22
- Status: Proposed（待使用者審核；本文件不改變任何生產狀態）
- Scope: `both`（requirements + architecture）
- Supersedes（核准後）: [2026-10-03 GitHub / SQLite baseline](../baseline/2026-10-03-riftversus-github-sqlite.md) 中的部署、排程、checkpoint 與瀏覽器查詢傳輸 owner
- Preserves: [ADR-0001](../adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md) 的 facts／媒體權利／fail-closed 決策、[Comparison Identity and Canonical Avatar v2](2026-07-18-comparison-identity-avatar-v2-design.md)、[Public IDs and real media](2026-10-03-public-identity-real-media.md)、[SQLite query performance](2026-10-04-sqlite-query-performance.md) 的查詢語意

## 1. 背景與動機

目前部署架構（2026-10-03 baseline）：

- GitHub Actions `publish.yml` 是唯一排程寫入者：每次在全新 runner 上從私有 `cxyfer/RiftVersus-data` Release 還原 PostgreSQL 17 dump，執行 Leaguepedia sync、acceptance、匯出 SQLite、封存網站並部署 GitHub Pages。
- PostgreSQL 只作為暫時性 ingestion／restore 工具；正式資料的長期保存形式是 `pg_dump` checkpoint。
- 瀏覽器透過 `sql.js-httpvfs` Worker/WASM 與 Range request 直接查詢 Pages 上的 SQLite。

使用者要求的三項變更：

1. **重新設計前端 UI**。
2. **部署改為 Docker image**，移除現行 GitHub Actions 發布方式。
3. **使用 SQLite 維護資料**：SQLite 成為唯一的資料儲存與維護引擎，移除 PostgreSQL。

現行架構的成本：每次 sync 都要還原完整 PG dump、裝 PG client、跑 Playwright，私有 Release 與 Pages 綁死在 GitHub；ingestion（PostgreSQL）與 serving（SQLite）用兩套 schema、兩套查詢實作，必須靠 parity 測試維持一致；HTTPVFS 傳輸需要 Range／gzip HEAD／Worker 等特殊驗證。

## 2. 目標與非目標

### 2.1 目標

- G1：單一 Docker image（同一 image ID）提供 `serve`、`worker` 與所有一次性維運指令。
- G2：SQLite 是唯一資料庫：canonical 資料（facts、provenance、sync runs、publication generation、public IDs、媒體 metadata）與公開查詢快照都存在 SQLite。PostgreSQL 只在一次性遷移時以 `legacy-import` profile 出現，遷移完成後移除。
- G3：移除 `publish.yml` 與 GitHub Pages 部署；排程、單一 writer、逾時、失敗封存、通知與 secrets 注入都有明確的新 owner（§6.4）。
- G4：前端重新設計，提供清楚的對戰總覽、分組賽果、單局明細與統計拆解，並支援亮／暗主題與手機版；保留所有既有使用者契約（§8.1）。
- G5：保留 ADR-0001 的資料與媒體治理：Leaguepedia 是唯一自動 facts provider，未授權媒體 fail closed，生成頭像只是呈現輸出。
- G6：遷移不得遺失或改變已驗證的資料：同一份 checkpoint 經 PostgreSQL 與 SQLite canonical 兩條路徑匯出，`snapshotId` 必須完全相同（§7.5）。

### 2.2 非目標

- 新增或替換資料來源、放寬 Leaguepedia mapping／redirect／媒體權利 gate。
- 使用者帳號、伺服器端保存比較、評論等寫入型公開功能。
- 多主機高可用、Kubernetes、跨主機共用 SQLite 檔案。
- 以 Actions 或任何 CI 作為生產寫入者或部署者。
- 刪除既有私有 checkpoint Release、Docker volume 或備份（實體刪除不在範圍內，比照 2026-10-03 baseline）。

## 3. 決策點（PR 審核時請逐項確認）

每項列出建議預設；PR 核准即視為接受預設，除非審核時另行指定。

| # | 議題 | 建議預設 | 替代方案 | 理由 |
| --- | --- | --- | --- | --- |
| D1 | `ci.yml` 去留 | **保留為 PR／main 的純驗證**：移除 PostgreSQL service，新增 `docker build` 與容器 smoke／E2E。不持有生產 secrets，不 push image，不部署。 | 完全移除 Actions，只在本機驗證 | 「移除 Actions 部署方式」指的是 `publish.yml`；PR 驗證不屬於部署，且是目前唯一的自動回歸保護。 |
| D2 | image 由誰 build | **部署主機從已審核的 git commit／tag 執行 `docker compose build`**；image tag 為 `riftversus:<git-sha>`。 | 維運者手動 `docker buildx build --push` 到 GHCR，主機 `pull` | 不讓部署依賴任何 CI，也不需要 registry 憑證。主機資源不足時可改用替代方案，CLI 與 compose 不變。 |
| D3 | 排程 owner | **同一 image 的 `worker` 容器內建排程**（`restart: unless-stopped`），預設排程沿用現行 UTC `17 19 * * *`（current）與 `47 20 * * 6`（history）。 | 關閉內建排程（`WORKER_SCHEDULE=off`），由主機 cron／systemd timer 執行 `docker compose run --rm worker sync --once` | baseline 退場 resident scheduler 的前提是 Actions 擁有排程；Actions 移除後，排程放在 image 內才能做到「只靠 Docker image 部署」。兩種方式共用同一把 writer lock（§6.3）。 |
| D4 | 備份與異地保存 | **主備份**：volume 上的 SQLite online backup 加內容定址物件，保留 14 份，每次成功 sync 後執行。**異地保存**：由維運者用 restic／rclone 同步 `backups/`（文件化，不內建於 app）。私有 GitHub Release checkpoint writer 在 cutover 後退場，只保留遷移用的唯讀 importer，遷移完成後一併移除。 | 保留 `release-store` 作為可選 off-site adapter（需要長期保存 `RIFTVERSUS_DATA_TOKEN`） | 降低 GitHub 耦合與 entropy。既有 Releases 保留為歷史復原證據，不刪除。 |
| D5 | 前端資料傳輸 | **server JSON API**：server 以 `node:sqlite` 唯讀開啟已發布快照，重用 `@riftversus/domain` 的 `searchSqlite`／`compareSqlite`。移除 `sql.js-httpvfs`、Worker/WASM 與 Range 傳輸。 | 保留 HTTPVFS，容器只提供靜態檔與 Range | 有 server 之後，查詢放在 server 端更簡單、更快，也更容易觀測；查詢語意仍由 domain 單一 owner 實作，不產生第二套查詢。 |
| D6 | GitHub Pages 與 base path | **Pages 最後部署一次 redirect 頁**：帶 path／query 轉址到新 origin，並轉移保存的比較（§8.6），之後 Pages 不再更新。base path 改為可設定的 `PUBLIC_BASE_PATH`，預設 `/`；舊 `/RiftVersus/` 前綴在新 server 上以 308 導向。 | 直接停用 Pages，接受分享連結與 localStorage 失效 | 保護既有分享連結與使用者保存資料。redirect 頁可由 Pages「Deploy from branch」發布，不需要本 repo 的 workflow。 |
| D7 | 部署主機 | **host-agnostic**：規格只假設單一 Linux 主機、Docker Engine 與 Compose v2、本機磁碟 volume。TLS／網域由維運者的 reverse proxy 負責；容器只提供 HTTP `:8080`。 | 指定雲端供應商 | 主機尚未決定，規格不綁供應商。 |
| D8 | 每次發布的瀏覽器驗證 | **生產 worker 不內建 Playwright**。每次發布執行 HTTP 層 smoke（API、媒體、image credits、acceptance fixture）；瀏覽器 E2E（截圖、PNG／ZIP 匯出、mobile）在 CI 對 image 執行，並在 cutover 與每次 image 升級時跑一次 release 版 E2E。 | production image 內含 Chromium，每次發布都截圖 | Chromium 會讓 image 增加數百 MB。資料發布不改前端程式碼，瀏覽器行為由 image 版本決定，應該跟 image 一起驗證。 |

## 4. Baseline 對照（2026-10-03 → 本規格）

| 2026-10-03 baseline owner／條目 | 本規格處置 | 新 owner |
| --- | --- | --- |
| Leaguepedia 擁有 source facts；reviewed mapping／redirect fail closed | **保留** | 不變 |
| `data/leaguepedia/competition-map.json` 擁有 competition／year source key | **保留**（worker 讀同一檔，取代 workflow 的 env 注入） | 不變 |
| 私有 `RiftVersus-data` immutable checkpoint Release 擁有持久化 PG dump | **取代** | volume 上的 SQLite canonical DB 加 backup 集（§7.6）；既有 Releases 只作遷移來源與歷史證據 |
| 失敗 attempt 為獨立 forensic 封存，不得作為還原基礎 | **保留語意，改變位置** | `/data/attempts/<runId>/`（§6.4） |
| `apps/data` 擁有一次性 migration／import／acceptance／export；PG 僅為暫時性工具 | **取代** | `apps/data` 保留指令 owner；canonical 儲存改為 SQLite，PG 只在 `legacy-import` |
| 正規化、加索引的 SQLite 擁有公開查詢執行（schema 3） | **保留**（schema 與 domain 查詢不變） | 執行位置從瀏覽器 Worker 移到 server |
| 瀏覽器使用 pinned `sql.js-httpvfs` Worker/WASM 與 Range | **取代**（D5） | `apps/server` JSON API |
| Actions `publish.yml` 為單一排程 publisher，含 writer lock | **取代**（D3） | `worker` 容器加檔案鎖加 `BEGIN IMMEDIATE` |
| GitHub Pages 提供公開網站 | **取代**（D6） | `serve` 容器 |
| 網站 rollback 選 immutable site，不回捲 data lineage | **保留語意** | `snapshot rollback <snapshotId>` 只切換 current 指標 |
| Fastify server、舊 Docker image、resident scheduler 已退場 | **刻意復活並重新定義**（本規格的需求變更） | 新 `apps/server`、新 Dockerfile、worker 排程；不恢復舊 PostgreSQL／S3／MinIO 依賴 |
| URL 分享、保存比較、匯出為 client 功能；無 HTTP API fallback | **部分取代**：分享／保存／匯出仍是 client 功能；資料查詢改走 API（不是 fallback，而是唯一路徑） | `apps/server` |
| 可讀 entity／era URL key 有持久化 scoped ownership | **保留** | SQLite canonical `entity_public_ids`／`team_era_public_ids` |

核准後需新增 **ADR-0002**（Docker／SQLite 自主部署），並對 ADR-0001 的 Compatibility Boundary 補充 amendment：facts 讀取改為「已發布的 SQLite 快照」，頭像生成 owner 為 export pipeline（不是已退場的 Fastify 生成器）。ADR 檔案在 P1 PR 中建立。

## 5. 目標架構

```text
                ┌───────────────────────── Docker host（單一主機、本機磁碟） ─────────────────────────┐
                │                                                                                    │
 Leaguepedia ◀──┤  worker 容器（riftversus:<sha>  `worker`）                                         │
   API          │    排程／手動 CLI → writer lock → sync → canonical.sqlite（WAL）                   │
                │      → acceptance → export snapshot → verify/smoke → promote current.json → backup │
                │                                                                                    │
                │  volume riftversus-data:/data                                                      │
                │    db/canonical.sqlite      snapshots/<snapshotId>/{snapshot.sqlite,media/,...}    │
                │    snapshots/current.json   objects/<sha256>   backups/   attempts/   locks/       │
                │                                                                                    │
 使用者 ─▶ proxy ─▶ web 容器（riftversus:<sha>  `serve`，/data/snapshots 唯讀掛載）                 │
  (TLS)         │    GET / (SPA)   GET /api/v1/*   GET /media/*   GET /presentation/*              │
                └────────────────────────────────────────────────────────────────────────────────────┘
```

要點：

- **兩種 SQLite 檔，兩個 owner**：
  - `canonical.sqlite`：可寫、WAL，只有 worker 寫入。
  - `snapshots/<id>/snapshot.sqlite`：不可變，由 export 產生，使用 `journal_mode=DELETE`、權限 `0444`；web 以 `immutable=1` 唯讀開啟。
  - web 從不開啟 canonical DB，因此不會跨容器共用 WAL。
- **發布即切換指標**：worker 驗證新快照後，以 write-temp → fsync → rename 原子更新 `current.json`。web 偵測到指標變更後開新連線，等進行中的請求完成，再關閉舊連線。
- **查詢語意單一 owner**：`@riftversus/domain` 的 SQLite schema v3 與 `searchSqlite`／`compareSqlite` 不變，只把執行環境從瀏覽器 `sql.js` 換成 server 的 `node:sqlite`（該 executor 介面已存在）。

### 5.1 Workspace 調整

| Workspace | 變更 |
| --- | --- |
| `packages/contracts` | 保留；新增 API envelope、錯誤碼、統計拆解（§8.4）等 additive schema |
| `packages/domain` | 保留 schema v3 與查詢；新增統計拆解查詢（additive，schema 有變動時升為 v4 並同時支援 v3 讀取） |
| `packages/database` | Kysely dialect 從 `pg` 改為 SQLite；以 SQLite baseline migration 取代 14 個 PG migration；移除 `pg`／`@types/pg` |
| `packages/sync` | 保留 Leaguepedia provider 與 filesystem object store；移除 PG 專屬鎖 |
| `apps/data` | 保留 sync／acceptance／export／mapping／freshness；新增 `snapshot promote|rollback|list`、`backup *`、`legacy import-postgres`；退場 GitHub publish／site／archive／checkpoint-release 指令（§10） |
| `apps/server`（重建） | HTTP server、API、靜態檔、snapshot 熱切換、`worker` 排程入口 |
| `apps/web` | 新 UI；`http-runtime` 取代 `static-runtime`；保留 `mock-runtime` 供測試 |

## 6. 部署需求（Docker）

### 6.1 Image

- R-DEP-01：根目錄 `Dockerfile` 採多階段建置：`deps`（`pnpm fetch` + `--frozen-lockfile`）、`build`（`pnpm build`、web production bundle）、`runtime`（`pnpm deploy --prod` 的精簡依賴）。
- R-DEP-02：runtime base 為 `node:24-bookworm-slim` 並以 digest 鎖定；使用非 root 使用者（UID／GID `10001`）；以 `tini` 作為 PID 1；`NODE_ENV=production`。
- R-DEP-03：image 不含任何 secret、`.env`、測試 fixture 以外的資料、PostgreSQL client 或 Chromium；secret 只在 runtime 以 env file 注入，不得出現在 build arg、`ENV` 預設值或 config summary。
- R-DEP-04：必須能在 `read_only: true` rootfs 下執行；可寫路徑只有 `/data`（worker）與 `/tmp`（tmpfs）。
- R-DEP-05：OCI labels 包含 `org.opencontainers.image.revision`（git SHA）、`version`、`source`；`riftversus version` 輸出相同資訊。
- R-DEP-06：單一 entrypoint `riftversus <command>`；`serve` 與 `worker` 不得在同一容器同時執行。
- R-DEP-07：資源預算（P2 實測後寫入證據，超出時需在 PR 說明）：未壓縮 image ≤ 300 MB；web 閒置 RSS ≤ 150 MB；worker 閒置 RSS ≤ 150 MB。

### 6.2 Compose 與設定

- R-DEP-10：`compose.yaml` 改為以下服務：
  - `web`（`serve`，port `127.0.0.1:${WEB_PORT:-8080}:8080`，`/data/snapshots` 唯讀，healthcheck `riftversus healthcheck web`）
  - `worker`（`worker`，`/data` 可寫，healthcheck `riftversus healthcheck worker`）
  - `postgres`（只在 profile `legacy-import`，P5 移除）
  - MinIO `legacy-recovery` profile 在 P5 移除（既有 named volume 保留不刪）。
- R-DEP-11：所有服務以 `${RIFTVERSUS_IMAGE:-riftversus:local}` 使用同一 image；部署證據必須記錄 web 與 worker 的 image ID 相同。
- R-DEP-12：設定只來自環境變數；`.env.example` 重寫，至少包含：
  - 服務設定：`PUBLIC_BASE_PATH`、`PUBLIC_ORIGIN`、`DATA_DIR=/data`
  - 排程與執行：`WORKER_SCHEDULE`（`on|off`）、`SYNC_CURRENT_CRON`、`SYNC_HISTORY_CRON`、`SYNC_RUN_TIMEOUT_MINUTES=180`、`BACKUP_RETAIN=14`、`ALERT_WEBHOOK_URL`（可選）
  - 既有 Leaguepedia 與 sync 參數（保留現有的範例 domain 拒絕機制）
  - 移除 `DATABASE_URL`、S3 與 MinIO 變數（`legacy-import` 專用變數另外標示）。
- R-DEP-13：SQLite 檔必須位於本機區塊儲存的 Docker volume 或 bind mount。不支援 NFS／SMB／雲端同步資料夾；worker 啟動時偵測到網路檔案系統即拒絕啟動。web 與 worker 必須在同一主機。
- R-DEP-14：舊路徑相容：`/RiftVersus/*` 以 308 導向 `${PUBLIC_BASE_PATH}*` 並保留 query。

### 6.3 單一 writer

- R-DEP-20：所有寫入 canonical DB 或 `snapshots/` 的指令（sync、backfill、history、media、migrate、snapshot promote／rollback、backup restore）都必須先取得 `/data/locks/writer.lock` 的獨占 `flock`，再以 `BEGIN IMMEDIATE` 開始寫入交易。取不到鎖時立即以 `status: locked` 結束並回傳非零 exit code，不排隊等待，與現行 `cancel-in-progress: false` 加 `locked` 狀態的語意一致。
- R-DEP-21：canonical DB 連線固定設定 `journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`、`synchronous=NORMAL`；發布與備份的檢查點使用 `synchronous=FULL` 並執行 `wal_checkpoint(TRUNCATE)`。

### 6.4 Actions 功能的新 owner

| 現行 Actions 提供 | 新 owner | 需求 |
| --- | --- | --- |
| `schedule` cron | worker 內建排程（D3） | R-OPS-01：以 UTC 解讀 cron；錯過的排程（容器停機）在啟動後補跑一次，不重複補跑多次 |
| `concurrency` 單一 writer | writer lock（§6.3） | 同上 R-DEP-20 |
| `timeout-minutes: 180` | `SYNC_RUN_TIMEOUT_MINUTES` | R-OPS-02：逾時以 `AbortSignal` 中止，run 記為 `failed`，候選快照丟棄，current 不變 |
| 失敗 attempt 封存 | `/data/attempts/<runId>/` | R-OPS-03：保存 diagnostics、使用到的 raw object hash 清單、錯誤摘要；保留最近 30 筆；明確標示「不得作為還原基礎」 |
| Actions 失敗通知 | `sync_runs` 表、`freshness`、可選 webhook | R-OPS-04：失敗或 freshness 不健康時，若設定了 `ALERT_WEBHOOK_URL`，POST 一筆不含 secret 的 JSON；worker healthcheck 反映 freshness |
| secrets／vars 注入 | runtime env file | R-DEP-03 |
| `workflow_dispatch` 各 mode | CLI（§6.5） | 每個 mode 都有對應指令 |
| 每次 runner 從 checkpoint 全新還原 | 增量 canonical DB 加定期重建驗證 | R-OPS-05：每週 history run 後執行 `snapshot rebuild --verify`：從 canonical DB 重新匯出，必須與 current 的 `snapshotId` 一致，否則告警且不 promote |
| Pages 部署後的 hosted smoke | promote 前的 HTTP smoke（D8） | R-OPS-06：smoke 對候選快照啟動 in-process server，驗證 meta、預設比較、acceptance fixture（T1 vs LPL Worlds BO5）、媒體與 image credits |

### 6.5 指令對照

| 現行 | 新指令（皆在同一 image） |
| --- | --- |
| `publish.yml` mode `current` | 排程或 `riftversus sync --once` |
| mode `history` | 排程或 `riftversus sync --history-once` |
| mode `backfill` | `riftversus backfill --year YYYY --competition NAME` |
| mode `media` | `riftversus media`（改用本機 object store，不再需要 Release token） |
| mode `reexport`／`rebuild` | `riftversus snapshot export` 後接 `snapshot promote`／`riftversus snapshot rebuild [--verify]` |
| mode `rollback` | `riftversus snapshot rollback <snapshotId>`、`snapshot list` |
| `checkpoint pack|verify|restore` | `riftversus backup create|verify|restore` |
| `migrate` | `riftversus migrate`（SQLite canonical） |
| —（新增） | `riftversus legacy import-postgres`（只在 P1–P5 存在） |

發布管線（每次 sync 成功後）：

1. 預先備份 canonical DB；
2. sync 寫入新的 publication generation；
3. 執行 acceptance；
4. export 到 `snapshots/.staging-<runId>/`，完成後 rename 成 `snapshots/<snapshotId>/`；
5. `snapshot verify` 與 smoke；
6. promote；
7. 備份。

任何一步失敗時，current 維持原狀，並寫入 attempt 封存。

### 6.6 升級與回復

- R-DEP-30：升級順序：`docker compose build`（或 pull）→ `docker compose run --rm worker migrate`（自動先備份）→ `docker compose up -d`。worker 偵測到待執行的 migration 時拒絕啟動排程（fail closed）。
- R-DEP-31：migration 只向前執行；image 回復時，若 schema 已升級，必須先 `backup restore` 到升級前的備份。
- R-DEP-32：web 必須能讀取目前與前一版 snapshot schema（現在是 v3；若升為 v4，必須同時支援 v3），讓 snapshot rollback 不受 image 版本限制。

## 7. 資料需求（SQLite）

### 7.1 Canonical schema

- R-DATA-01：以單一 SQLite baseline migration `sqlite/001_baseline` 重建 PG migration 001–014 最終狀態的 21 張表。表名、欄位與約束語意需與 PG 等價：

  ```text
  coverage_status, dataset_versions, entities, entity_aliases, entity_public_ids,
  fact_mutation_audits, fact_mutation_authorizations, game_facts, game_players,
  media_assets, media_objects, override_application_runs, override_applications,
  series_facts, source_cursors, source_objects, sync_runs, team_era_public_ids,
  team_eras, team_region_history, tournaments
  ```

  PG migration 檔移到 `packages/database/legacy-postgres/`，只供 importer 使用，P5 刪除。
- R-DATA-02：表格須宣告 `STRICT`；所有 CHECK／UNIQUE／FK 都要移植；每個連線設定 `foreign_keys=ON`。

### 7.2 PostgreSQL → SQLite 差異處理

| PG 功能（現有使用處） | SQLite 處理 | 驗收 |
| --- | --- | --- |
| `ilike` 搜尋（`repositories/entities.ts`） | 寫入時另存 `*_fold` 正規化欄位（NFKC 加 Unicode lowercase，由 app 計算）；查詢用 `=`／`LIKE … ESCAPE '\'` 比對 fold 欄位。SQLite 內建 `LIKE` 只對 ASCII 不分大小寫，禁止直接使用 | 韓文、中文、全形、含 `%`／`_` 的名稱測試 |
| `pg_trgm`（migration 008） | 不移植；若 plan 階段量測顯示需要子字串索引，改用 FTS5 `trigram` tokenizer（Node 24.12 內建 SQLite 3.50.4 已驗證可用） | 搜尋延遲證據 |
| `pg_advisory_xact_lock`／`pg_advisory_unlock`（`repositories/sync.ts`） | writer lock（R-DEP-20） | 併發 sync 回傳 `locked` 的測試 |
| `jsonb` | `TEXT` 加 `CHECK (json_valid(col))`；序列化採穩定鍵序 | round-trip 測試 |
| `date`（自訂 parser `parsePostgresDateText`） | `TEXT` 加 `CHECK (col GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`，並在應用層以 `DateSchema` 驗證 | 日期邊界測試沿用 |
| `timestamptz` | `TEXT` ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SS.sssZ`），排序以字串比較 | 時區與排序測試 |
| `boolean` | `INTEGER` 加 `CHECK (col IN (0,1))`，Kysely 層轉成 boolean | — |
| `bigint`／serial | `INTEGER`；超出 `Number.MAX_SAFE_INTEGER` 時讀取失敗（fail closed） | — |
| `uuid` | `TEXT` 加格式 CHECK | — |
| 交易隔離、`FOR UPDATE` | SQLite 單一 writer 下為 serializable，不需要 row lock | — |
| `pg_dump`／`pg_restore` checkpoint | SQLite online backup（§7.6） | restore drill |

- R-DATA-03：驅動優先使用 Node 內建 `node:sqlite`（`DatabaseSync`，export 已在使用）並為 Kysely 撰寫 dialect adapter；若 plan 階段驗證 Kysely 相容性、交易或效能不足，改用 `better-sqlite3`。此選擇在 P1 PR 以測試證據定案，本規格不預設結論。`node:sqlite` 在 Node 24 仍標示為 experimental，必須鎖定 Node 小版本並在升級時跑完整測試。

### 7.3 Publication generation 與 fail-closed

- R-DATA-10：保留現有 `dataset_versions`（append-only）與 publication generation 語意：sync 寫入的 facts 在 acceptance 通過且 generation 被 promote 之前不得出現在任何公開快照。
- R-DATA-11：source correction、alternative game review、identity overrides 的載入與 checksum 驗證不變；raw source 回應仍以內容定址存在 `objects/<sha256>`，immutable。
- R-DATA-12：既有 fail-closed gate（mapping 缺漏、redirect 目標缺 player dimension、BO2／格式證據、partial coverage）不得因為換引擎而放寬；所有既有 gate 測試改在 SQLite 上執行並通過。

### 7.4 公開快照

- R-DATA-20：快照目錄 `snapshots/<snapshotId>/` 包含：
  - `snapshot.sqlite`（schema v3，或核准的 v4）
  - `manifest.json`（snapshotId、schemaVersion、sha256、bytes、datasetVersion、coverage、sourceCheckpoint／generation、createdAt、image revision）
  - `media/`（retained licensed media 與 deterministic v2 avatar）
  - `presentation/image-credits.html`
- R-DATA-21：`snapshotId` 的計算方式不變（`snapshotDigest`），保留 deterministic export。
- R-DATA-22：保留最近 10 個快照加上 current 指向的快照；`snapshot prune` 不得刪除 current 或 `previous`。

### 7.5 一次性遷移（PostgreSQL checkpoint → SQLite canonical）

- R-DATA-30：遷移來源是遷移當下以 `archive resolve` 取得的最新 verified checkpoint；其 checkpoint ID、sequence、series 數寫入遷移證據。本機未 promote 的資料不屬於遷移來源；cutover 後由 worker 依 repo 內已審核的 corrections 重跑 history 重現。
- R-DATA-31：`legacy import-postgres` 流程：
  1. 在 `legacy-import` profile 的 PG 17 還原 checkpoint；
  2. 以 PG 路徑匯出快照 A；
  3. 依 FK 拓撲順序把 21 張表複製到新的 SQLite canonical；
  4. 以 SQLite 路徑匯出快照 B。
- R-DATA-32（parity gate，全部必須成立，否則中止且不得 cutover）：
  - `snapshotId(A) == snapshotId(B)`；
  - 每張表的 row count 相等；
  - 每張表依主鍵排序後，正規化 row 的 sha256 相等；
  - `entity_public_ids`／`team_era_public_ids` 完全一致（715／104 這類既有計數以實際 checkpoint 為準）；
  - legacy UUID 與 readable 分享連結解析到相同主體；
  - 若 Pages 上目前部署的網站來自同一 checkpoint，`snapshotId(B)` 等於該站 manifest 的 snapshotId。
- R-DATA-33：遷移後執行 `backup create`，並在乾淨 volume 上執行 `backup restore` 演練，restore 後的 export 必須重現相同 snapshotId。

### 7.6 備份

- R-DATA-40：`backup create`：
  1. 以 SQLite backup API 或 `VACUUM INTO` 寫到暫存檔；
  2. 執行 `PRAGMA integrity_check` 與 `foreign_key_check`；
  3. 寫入 sha256 manifest，連同本次引用的 object hash 清單；
  4. fsync 後 rename 到 `backups/<timestamp>-<generation>/`。

  objects 以內容定址增量保存。
- R-DATA-41：`backup verify` 會重新計算 checksum 並在暫存目錄試開資料庫；`backup restore` 需要取得 writer lock，並先把現有 DB 移到 `backups/pre-restore-*`，不得直接覆寫。
- R-DATA-42：保留 `BACKUP_RETAIN` 份；異地保存依 D4 由維運者處理，`docs/operations.md` 提供 restic 範例。

## 8. 前端需求（UI 重設計）

### 8.1 必須保留的使用者契約

下表每項都對應既有測試；重設計可以改寫測試的 selector，但不得刪除行為斷言。

| 契約 | 現有證據 |
| --- | --- |
| URL 狀態：`leftKind/leftId/leftEraId/rightKind/rightId/rightEraId/from/to/events/leagues/bestOf` 參數名稱與語意不變；legacy UUID 連結 canonicalize 成 readable ID 並保留篩選；未知 readable ID 保留在 URL 並顯示復原提示；無效狀態以 canonical 預設取代 | `app.test.tsx`：readable／legacy／unknown／invalid route 案例 |
| 預設比較 T1 vs LPL、2019-01-01–2026-12-31、Worlds、BO5 | `defaultRouteState`、`test/default-comparison.test.ts` |
| 保存／載入／刪除比較；localStorage key `riftversus.saved-comparisons` 可讀 | `storage.test.ts`、`app.test.tsx` |
| PNG 與多頁 ZIP 匯出：每頁含可解碼的可見像素；分頁不重排；不混用不同 dataset publication 或不同篩選的頁面；1000 列上限；BO2 draw 不算輸；單局不完整標記；圖片失敗時改用 placeholder | `export-result.test.ts`、`ExportButton.test.tsx`、E2E 匯出測試 |
| player 顯示 `ID (真名)`；歷史隊伍／team-era 標籤；每局成員（per-game membership） | `app.test.tsx` summary／rows 案例 |
| coverage warning、`單局明細不完整`、BO2 `DRAW` | 同上 |
| Combobox ARIA：`role=combobox`、`aria-expanded`、`aria-activedescendant`、鍵盤上下／Enter／Escape、blur 還原、Enter 無選項時不送出 | `app.test.tsx` combobox 案例 |
| 圖片來源與權利聲明頁連結 | footer、`presentation/image-credits.html` |
| cursor 分頁（50 列一頁） | `app.test.tsx` 分頁案例 |
| 手機寬度不出現水平捲動 | E2E mobile |

### 8.2 設計方向

- 主題概念「**轉播計分板**」：比較雙方以一致的側色貫穿總覽、賽果列與圖表（左側藍 `--side-a`、右側紅 `--side-b`，呼應峽谷藍紅方）；資料密度高但層次清楚，數字一律使用 tabular numerals。
- 字體：UI 內文使用 `Noto Sans TC`，比分與大數字使用 `Barlow Condensed`。兩者皆為 OFL，以 `woff2` 自行託管在 image 內，不使用外部字型 CDN（配合 CSP，也避免第三方請求）。CJK 字型體積大，必須做子集化並以 `unicode-range` 分片、`font-display: swap` 載入；字型不計入 R-API-04 的 JS 預算，但首屏字型下載量須 ≤ 400 KB。
- Design tokens 定義在 `:root` 的 CSS custom properties：色彩（背景、表面、文字、muted、線條、accent、side-a、side-b、win、loss、draw、warning）、間距（4px 基準）、圓角、陰影、字級階層。
- 主題：預設跟隨 `prefers-color-scheme`，可手動切換亮／暗／系統，偏好存在 localStorage。兩個主題都要達 WCAG 2.2 AA 對比；側色在兩個主題下都要能和 win／loss 色區分，並附非顏色的辨識方式（文字或圖示）。
- 樣式技術：沿用純 CSS，按元件拆檔並使用 tokens；不引入 UI framework 或 CSS-in-JS。圖示沿用 `lucide-react`；圖表用手寫 SVG 元件，不引入圖表函式庫。

### 8.3 資訊架構與版面

單頁應用，由上而下：

1. **Top bar**：wordmark；資料狀態膠囊（快照日期、涵蓋範圍，點開顯示 snapshotId 與最後同步時間）；保存清單；主題切換。
2. **對戰舞台（Matchup stage）**：左右兩張主體卡，含大頭像或隊標、名稱、真名、類型；team 主體有 era 時顯示 era 標籤。卡片內嵌搜尋 combobox，中間是交換按鈕。主體一變更就立即套用。
3. **篩選列**：日期快速選項（全部、近 1 年、近 3 年、自訂區間）、賽事類型、聯賽、賽制，以 chip 呈現。桌面版為單列可換行；寬度 < 768px 時收進 bottom sheet，並顯示啟用中的篩選數。篩選變更立即套用（URL 以 `push` 記錄，同一互動內的多次變更合併成一筆），日期區間無效時以 inline 錯誤提示並且不套用。
   - 此項是**行為變更**：移除「套用篩選」按鈕與 draft 狀態，相關測試改寫成新語意；「Enter 無選項不送出」「blur 還原」等 combobox 斷言保留。
4. **總覽計分板**：大字顯示 series W–L（有 draw 時另列）、game W–L；以兩側色分割的勝率條；最近 5 場系列賽戰績（W／L／D 標記，附文字）。
5. **統計拆解**：依年份（各年系列賽勝負長條）與依賽事類型的小型 SVG 圖。資料由 API 對完整篩選集合計算（§8.4），不從已載入的分頁推算。
6. **賽果清單**：依年份分組，sticky 年份標題。每列顯示日期、賽事名稱、BO、雙方當時隊名、比分與結果徽章（WIN／LOSS／DRAW）。點開可看單局明細：每局勝方、雙方隊伍；player 比較時加上該局成員。單局資料不完整時明確標示。分頁以「載入更多」加上 IntersectionObserver 自動載入（自動載入可關閉；reduced-motion 時不自動載入）。
7. **匯出**：PNG／ZIP 按鈕放在總覽區；匯出版面以新視覺重做，但保留 1200px 固定寬度與既有分頁、gate 規則。
8. **保存清單**：右側 drawer（手機為全螢幕 sheet），項目顯示雙方名稱、篩選摘要與保存日期。
9. **狀態**：skeleton 載入；資料錯誤時提供重試；未知主體時提供重新選擇的引導；查無賽果時說明目前篩選並提供「清除篩選」。
10. **Footer**：Leaguepedia 來源與授權標示、圖片權利聲明、snapshotId 與 image revision。

斷點：≥ 1200px 為三欄舞台加完整篩選列；768–1199px 為縮小卡片；< 768px 時卡片上下堆疊、交換按鈕置中、篩選收進 bottom sheet、賽果列改為兩行。支援最小寬度 320px。

### 8.4 API（`/api/v1`）

所有回應以 `packages/contracts` 的 zod schema 驗證（server 輸出前、client 接收後都驗證）。錯誤格式：`{ error: { code, message } }`。

| Method／Path | 回應 | 備註 |
| --- | --- | --- |
| `GET /api/v1/meta` | `{ snapshotId, schemaVersion, dataset, coverage, lastSuccessfulSyncAt, imageRevision }` | `Cache-Control: no-cache`，`ETag: snapshotId` |
| `GET /api/v1/entities?q=&kinds=` | `ResolvedSubject[]`（最多 20） | `q` 長度 1–64；每 IP rate limit（預設 30 req／10s） |
| `GET /api/v1/subjects/resolve?kind=&id=&eraId=` | `ResolvedSubject` | 未知時回 `404 unknown_subject`（對應 `UnknownPublicSubjectError`） |
| `GET /api/v1/comparison?<route query>&cursor=` | `ComparisonResponse` 分頁 | cursor 綁定 snapshotId；快照已切換時回 `409 snapshot_changed`，client 從第一頁重新載入；匯出遇到此錯誤時整份中止，不混用不同快照的頁面 |
| `GET /api/v1/comparison/breakdown?<route query>` | `{ byYear[], byEvent[], recentForm[] }` | 新增的 additive contract |
| `GET /healthz` | process 存活 | 不存取資料 |
| `GET /readyz` | current 快照已載入且 schema 受支援 | 資料過期不影響 readiness，只在 `meta` 與 worker health 中反映 |

- R-API-01：API 只讀已發布快照，不得呼叫 Leaguepedia 或任何上游服務（沿用 ADR-0001）。
- R-API-02：靜態資源：`/assets/*` 帶 hash，設 `immutable, max-age=31536000`；`/media/*` 與 `/presentation/*` 從 current 快照目錄提供，路徑經 safe-path 驗證，禁止目錄跳脫與 symlink；其他 GET 以 SPA fallback 回 `index.html`（`no-cache`）。
- R-API-03：安全標頭包括 CSP（`default-src 'self'`；`img-src 'self' data: blob:`，供匯出使用）、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`；不啟用 CORS。
- R-API-04：效能：server 端 p95 ≤ 150 ms（預設比較與搜尋，熱快取，P2 量測）；首頁初始 JS ≤ 180 KB gzip。

### 8.5 Web runtime

- R-WEB-01：`ComparisonApi` 介面保留；新增 `http-runtime` 作為 production 實作，`mock-runtime` 保留給單元測試；移除 `static-runtime`、`snapshot-client` 與 `sql.js-httpvfs` 依賴。
- R-WEB-02：`lang="zh-Hant"`；UI 字串集中在單一模組（目前只有 zh-TW，為日後 i18n 預留）。
- R-WEB-03：遵守 `prefers-reduced-motion`；所有互動元件可用鍵盤操作，並有可見焦點。

### 8.6 舊 origin 遷移（D6）

- R-WEB-10：Pages 最後一次部署只包含一個 redirect 頁，流程如下：
  1. 讀取舊 origin 的 `riftversus.saved-comparisons`；
  2. 以 base64url 放進 URL fragment（`#import-saved=`；fragment 不會送到 server，且限制 32 KB）；
  3. 連同原 path／query 導向新 origin。
- R-WEB-11：新 app 偵測到 `#import-saved` 時，先驗證 schema，顯示「匯入 N 筆保存比較」確認提示，確認後以 id 去重合併，然後清除 fragment。驗證失敗時忽略匯入並提示，不得影響主流程。
- R-WEB-12：保存清單新增「匯出／匯入 JSON」功能，作為手動備援。

## 9. 測試與驗收

### 9.1 測試調整

- 單元與 workspace 測試保留；原本依賴 PG 的 integration suite 改為 SQLite（暫存檔，每個測試一個 DB），不再需要 `TEST_DATABASE_URL`。
- `legacy import-postgres` 的 parity 測試只在 `legacy-import` profile 或 CI 的選用 job 執行，並在 P5 隨 importer 一起移除。
- E2E：Playwright 對 `docker run` 起來的 image 執行，使用 synthetic fixture 快照。必須涵蓋預設比較、分享連結、搜尋 player 身分、PNG、ZIP、mobile viewport、快照切換時的 409 重新載入、主題切換與 saved 匯入。
- 移除 HTTPVFS 專屬測試（Range、gzip HEAD、Worker 損壞重試）與 `scripts/static-network-profile*`。
- 新增 server 測試：safe-path、安全標頭、rate limit、`/RiftVersus/` 308 導向、快照熱切換不中斷進行中的請求、writer lock 併發。

### 9.2 Cutover 驗收（全部成立才能停用 Pages／`publish.yml`）

1. R-DATA-32 parity gate 通過，並留存證據。
2. 在目標主機上 shadow run 至少 7 天：排程 current sync 連續成功 ≥ 7 次、history sync ≥ 1 次、`snapshot rebuild --verify` 一致、無未處理告警。這段期間 `publish.yml` 照常運作。
3. backup restore 演練在乾淨 volume 上重現相同 snapshotId。
4. release 版 E2E 在 desktop 與 mobile 對新 origin 通過，包括 PNG／ZIP 可見像素檢查。
5. web 與 worker 的 image ID 相同、以非 root 執行、rootfs 唯讀，資源量測符合 R-DEP-07。
6. 從新 origin 載入舊分享連結（legacy UUID、readable、`/RiftVersus/` 前綴）都解析到正確主體。
7. 只有在 1–6 全部通過後，才把 repo variable `PUBLISH_ENABLED` 設為 `false`、部署 Pages redirect 頁，並在後續 PR 刪除 `publish.yml`。

## 10. 退場清單（P5）

| 項目 | 處置 |
| --- | --- |
| `.github/workflows/publish.yml` | 刪除 |
| `ci.yml` 的 PostgreSQL service、PG client 安裝、checkpoint DB 建立 | 刪除；新增 docker build 與容器 E2E（D1） |
| `apps/data`：`publish-run`、`publish-github`、`publish-plan`、`site-bundle`、`site-commands`、`archive-commands`、`release-store`、`checkpoint-release`、`checkpoint`（PG）、`postgres-checkpoint`，以及 Release 版 `attempt-archive` | 刪除，或改寫為本機版本（attempt） |
| `packages/database` 的 `pg` 依賴與 `legacy-postgres/` migrations | importer 退場後刪除 |
| `apps/web`：`static-runtime`、`snapshot-client`、`sql.js-httpvfs` | 刪除；release E2E（`RIFTVERSUS_E2E_BASE_URL`）改指向新 origin |
| `scripts/measure-static-sqlite.mjs`、`verify-hosted-workflows.mjs`、`static-network-profile*` | 刪除（`build-static-fixture.mjs` 若仍用於產生 E2E fixture 快照則改寫保留） |
| `test/github-publish.test.ts`、`test/github-ci.test.ts` | 改寫為驗證新的 `ci.yml` 與 Dockerfile／compose 約束 |
| compose 的 `postgres`、`minio` profile | 刪除（named volume 不刪） |
| 文件：`docs/github-publishing.md`、`github-pages-actions-proposal.md`、`checkpoints.md`、`site-archives.md` | 移到 `docs/archive/` 並標註為歷史紀錄；改寫 `README.md`、`deployment.md`、`operations.md`、`sqlite-development.md` |
| 私有 `RiftVersus-data` Releases、舊容器 volume、獨立備份 | **保留**，不刪除 |
| 新 baseline | P5 完成後新增 `docs/aegis/baseline/<date>-riftversus-docker-sqlite.md` |

## 11. 分階段計畫

每個 phase 是一個獨立 PR，前一階段通過後才進入下一階段。P5 之前生產環境仍由 `publish.yml` 與 Pages 提供。

| Phase | 內容 | 生產影響 |
| --- | --- | --- |
| P0 | 本規格（純文件） | 無 |
| P1 | SQLite canonical：dialect 與驅動定案（R-DATA-03）、baseline migration、repositories 移植、所有 gate 測試改在 SQLite 上執行、`legacy import-postgres` 與 parity gate、ADR-0002 與 ADR-0001 amendment | 無 |
| P2 | `apps/server`、API、`http-runtime`（暫時沿用舊 UI）、Dockerfile、compose、ci.yml 加入 docker build 與容器 E2E | 無 |
| P3 | worker 排程、writer lock、attempt 封存、告警、backup，並在目標主機開始 shadow run | 無（與 Pages 並行） |
| P4 | 前端重設計（可與 P3 並行），包含 saved 匯入與匯出 | 無 |
| P5 | 依 §9.2 cutover：Pages redirect、停用並刪除 `publish.yml`、退場清單、文件與新 baseline | 生產切換 |

## 12. 風險與緩解

| 風險 | 緩解 |
| --- | --- |
| 單一主機故障或磁碟損毀 | 每次 sync 後備份、異地 restic（D4）、restore 演練列為 cutover gate；快照不可變，可從備份重建 |
| 增量 canonical DB 隨時間漂移，失去 Actions 每次從 checkpoint 全新還原的乾淨性 | 每週 `snapshot rebuild --verify`（R-OPS-05）、`integrity_check`、所有寫入走 publication generation |
| `node:sqlite` 仍為 experimental | 鎖定 Node 小版本；P1 以證據決定驅動；executor 與 dialect 隔離在 adapter 內，可替換 |
| 非 ASCII 搜尋行為改變 | fold 欄位加多語測試（§7.2） |
| 換 origin 造成保存比較與分享連結遺失 | redirect 頁、fragment 匯入、JSON 匯出入、308 導向（§8.6、R-DEP-14） |
| 生產端不再每次截圖，瀏覽器回歸較晚發現 | 瀏覽器行為跟 image 版本走，在 CI 與 cutover／升級時驗證（D8） |
| resident 排程靜默失效 | worker healthcheck 反映 freshness；webhook 告警；`meta` 公開最後同步時間 |
| 遷移時 PG 與 SQLite 語意不一致 | R-DATA-32 嚴格 parity；未通過不得 cutover |

## 13. Governance 7 維度審查

| 維度 | 評估 |
| --- | --- |
| Ownership integrity | facts＝Leaguepedia；canonical 寫入＝worker（唯一 writer lock）；查詢語意＝`@riftversus/domain`；公開讀取＝web（只讀不可變快照）；排程＝worker（D3）；備份＝`backup` 指令。每項只有一個 owner。 |
| Module boundaries | web 只依賴 contracts／domain 的型別與 API；server 依賴 domain 查詢與 contracts；server 不 import `packages/sync`；worker 才使用 sync／database。 |
| Contract changes | 新增 `/api/v1`、breakdown contract、409 `snapshot_changed`、saved 匯入；行為變更：篩選立即套用、base path 預設 `/`。URL 參數與快照 schema v3 不變。 |
| Cascade proliferation | 移除 PG、Release store、Pages、HTTPVFS 四條外部依賴鏈；新增依賴只有 HTTP server 框架與排程函式庫（P2／P3 選定，需在 PR 說明理由）。 |
| Dependency direction | apps → packages；contracts 最穩定；domain 不依賴 database；不新增反向依賴。 |
| Retirement completeness | §10 逐項列出，並綁定 P5 cutover gate；PG 只以 `legacy-import` 暫存，有明確刪除時點。 |
| Entropy flow | 淨減少：一種資料庫引擎、一套查詢實作執行位置、無 Release 封存協定、無 Range 傳輸驗證。新增 server 與 worker 排程是 Actions 退場後的必要替代。 |

## 14. 待 plan 階段定案（不阻擋本規格核准）

- HTTP 框架（Fastify 5 或 Hono）與排程函式庫（croner 或自寫 UTC cron 解析），P2／P3 PR 以依賴大小與維護狀態說明選擇。
- Kysely 搭配 `node:sqlite` 或 `better-sqlite3`（R-DATA-03）。
- 是否需要 FTS5 trigram 索引（依搜尋延遲量測決定）。
- snapshot schema 是否升為 v4 以支援 breakdown 查詢效能（若升級，遵守 R-DEP-32）。
