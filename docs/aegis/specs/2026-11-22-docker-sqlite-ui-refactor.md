# RiftVersus 重構規格：Docker image 部署、SQLite 資料維護與前端 UI 重設計

- Date: 2026-11-22
- Status: Proposed（待使用者審核；本文件不改變任何生產狀態）
- Scope: `both`（requirements + architecture）
- Supersedes（核准且 P5 完成後）：[2026-10-03 GitHub / SQLite baseline](../baseline/2026-10-03-riftversus-github-sqlite.md) 中的部署、排程、持久化、checkpoint、媒體傳輸、網站 rollback 與瀏覽器查詢傳輸 owner
- Preserves：[ADR-0001](../adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md) 的 facts 與媒體權利決策（含 2026-10-04 reviewed editorial images amendment）、[Comparison Identity and Canonical Avatar v2](2026-07-18-comparison-identity-avatar-v2-design.md)、[Public IDs and real media](2026-10-03-public-identity-real-media.md)，以及 [SQLite query performance](2026-10-04-sqlite-query-performance.md) 的查詢語意

## 1. 背景與動機

目前的部署架構（2026-10-03 baseline 與後續的 ADR-0001 amendment）如下：

- GitHub Actions 的 `publish.yml` 是唯一的排程寫入者。每次執行都在全新 runner 上，從私有 `cxyfer/RiftVersus-data` Release 還原 PostgreSQL 17 dump 與物件，依序執行 Leaguepedia sync、匯出候選 SQLite、acceptance、瀏覽器驗證、封存網站，最後部署到 GitHub Pages。
- PostgreSQL 只是暫時性的 ingestion／restore 工具，長期資料以 `pg_dump` checkpoint 保存。審閱過的媒體位元組另外存放在私有的 immutable media Release。
- 瀏覽器透過 `sql.js-httpvfs` Worker/WASM 發送 Range request，直接查詢 Pages 上的 SQLite。

使用者要求三項變更：

1. 重新設計前端 UI。
2. 部署改為 Docker image，移除現行的 GitHub Actions 發布方式。
3. 以 SQLite 維護資料：SQLite 成為唯一的資料庫引擎，PostgreSQL 退場。

現行架構的成本：

- 每次 sync 都要還原完整的 PG dump、安裝 PG client 並執行 Playwright。
- 資料、媒體與網站封存全部綁在 GitHub Release 與 Pages 上。
- ingestion 與 serving 使用兩種資料庫引擎，必須靠 parity 測試維持一致。
- HTTPVFS 需要 Range、gzip HEAD、Worker 等專屬驗證。

## 2. 目標與非目標

### 2.1 目標

- **G1**：單一 production Docker image。`web` 與 `worker` 兩個服務使用同一個 image ID，所有日常維運指令也都在這個 image 內。
- **G2**：SQLite 是唯一的資料庫。
  - canonical 資料（facts、provenance、授權稽核、sync runs、publication generation、public ID、媒體 metadata）與公開查詢快照都存在 SQLite。
  - PostgreSQL 只出現在一次性遷移用的獨立 legacy 工具 image（§7.6），P5 後移除。
- **G3**：移除 `publish.yml` 與 GitHub Pages 部署。Actions 原本提供的每一項能力都要有明確的新 owner（§6.4），包括排程、單一 writer、等待中的 run、逾時、失敗封存、通知、secrets 注入與部署後驗證。
- **G4**：重新設計前端，提供對戰總覽、分組賽果、單局明細與統計拆解，支援亮色／暗色主題與手機版，並保留所有既有的使用者契約（§8.1）。
- **G5**：保留 ADR-0001 的資料與媒體治理：
  - Leaguepedia 是唯一的自動 facts provider。
  - 只發布具授權（license）的媒體，或具結構化 editorial rights basis 的審閱媒體；其他上游媒體一律 fail closed。
  - 生成頭像只是呈現輸出，不作為 provenance。
- **G6**：遷移不得遺失或改變已驗證的資料與物件。cutover 時從最後一份 verified checkpoint 重新遷移，並通過嚴格的 parity 檢查（§7.6、§9.3）。

### 2.2 非目標

- 新增或替換資料來源，或放寬 mapping、redirect、格式、覆蓋率、媒體權利等 gate。
- 使用者帳號、伺服器端保存比較等公開寫入功能。
- 多主機高可用、Kubernetes、跨主機共用 SQLite 檔案。
- 以 Actions 或任何 CI 作為生產環境的寫入者或部署者。
- 實體刪除既有的私有 Release、Docker volume 或備份。

## 3. 決策點（PR 審核時請逐項確認）

PR 核准即視為接受下表的建議預設；若要改用替代方案，請在審核時註明。

| # | 議題 | 建議預設 | 替代方案 | 理由 |
| --- | --- | --- | --- | --- |
| D1 | `ci.yml` 去留 | 保留為 PR／main 的純驗證：P5 前保留 PG service，作為舊發布路徑的回歸測試；新增 `docker build`、容器 E2E 與 legacy 工具 image build。CI 不持有生產 secret、不 push image、不部署。P5 移除 PG。 | 完全移除 Actions，只在本機驗證 | 「移除 Actions 部署方式」指的是 `publish.yml`；PR 驗證不屬於部署，而且是目前唯一的自動回歸保護。 |
| D2 | image 由誰 build | 部署主機以已審核的 git commit／tag 執行 `docker compose build`，tag 為 `riftversus:<git-sha>`。 | 維運者手動 `docker buildx build --push` 到 GHCR，主機再 `pull` | 部署不依賴任何 CI，也不需要 registry 憑證；兩種做法使用相同的 CLI 與 compose。 |
| D3 | 排程 owner | `worker` 容器內建排程，`restart: unless-stopped`。預設 UTC `17 19 * * *` 執行 current，`47 20 * * 6` 執行 history。 | 設 `WORKER_SCHEDULE=off`，改由主機 cron／systemd timer 執行 `docker compose run --rm worker run current` | baseline 當初讓 resident scheduler 退場，前提是 Actions 擁有排程。Actions 移除後，排程放進 image 才符合「只靠 Docker image 部署」。兩種做法共用同一套鎖與排程狀態（§6.3）。 |
| D4 | 備份與異地保存 | 主備份是 volume 上可獨立還原的備份集（DB 加上所有被引用的物件，§7.7），保留 14 份，每次 promote 後更新。異地保存由維運者以 restic／rclone 同步整個 `backups/`（含 `backups/objects/`），app 不內建，只提供文件範例。私有 GitHub Release writer 在 P5 退場。 | 保留 `release-store` 作為可選的異地 adapter（需要長期保存 `RIFTVERSUS_DATA_TOKEN`） | 降低對 GitHub 的耦合與系統 entropy。既有 Releases 保留，作為歷史證據與遷移來源，不刪除。 |
| D5 | 前端資料傳輸 | 改用 server JSON API：server 以 `node:sqlite` 唯讀開啟已發布的 release，重用 `@riftversus/domain` 的查詢。移除 `sql.js-httpvfs`、Worker/WASM 與 Range 傳輸。 | 保留 HTTPVFS，容器只提供靜態檔與 Range | 有了 server，查詢在 server 端執行更簡單、更快，也更容易觀測；查詢語意仍只由 domain 擁有。 |
| D6 | GitHub Pages、舊 origin 與 base path | Pages 最後部署一個遷移頁，提供 path／query 轉址、保存比較的轉移與 JSON 下載（§8.6），至少保留 12 個月。base path 改為 runtime 設定 `PUBLIC_BASE_PATH`，預設 `/`，同一個 image 必須支援任意前綴（§6.2）。 | 直接停用 Pages，接受分享連結與 localStorage 失效 | 保護既有分享連結與使用者的保存資料。遷移頁可以用 Pages 的「Deploy from branch」發布，不需要本 repo 的 workflow。 |
| D7 | 部署主機 | 不綁定主機：只假設單一 Linux 主機、Docker Engine 與 Compose v2，以及本機磁碟。TLS 與網域由維運者的 reverse proxy 負責，容器只開放 HTTP `:8080`。 | 指定雲端供應商 | 部署主機尚未決定。 |
| D8 | 每次發布的驗證 | production image 不含 Chromium。promote 前對候選 release 執行 in-process HTTP smoke；promote 後經 `PUBLIC_ORIGIN` 驗證對外身分（R-OPS-07）。瀏覽器 E2E（截圖、PNG/ZIP、mobile、冷啟動預算）在 CI 對 image 執行；cutover 與每次 image 升級時，再對正式 origin 跑一次 release 版 E2E。 | production image 內含 Chromium，每次發布都截圖 | Chromium 會讓 image 增加數百 MB。資料發布不會改動前端程式碼，瀏覽器行為只隨 image 版本改變。 |
| D9 | 審閱媒體的位元組來源 | 用 `riftversus media import <pack>` 從本機目錄或 archive 匯入審閱包，格式沿用現行 media Release manifest（整包 checksum、逐檔 checksum 與大小上限、file page/revision、rights basis、attribution、精確主體綁定）。審閱包由維運者自行下載，例如 `gh release download`。 | worker 直接讀取私有 media Release（需要 token） | 執行期不需要 GitHub token，審閱與校驗 gate 維持不變。 |

## 4. Baseline 與 ADR 對照

| 現行 owner／條目（2026-10-03 baseline、ADR-0001） | 處置 | 新 owner |
| --- | --- | --- |
| Leaguepedia 擁有 source facts；經審閱的 mapping／redirect／correction 採 fail closed | 保留 | 不變 |
| `data/leaguepedia/competition-map.json` 擁有 competition/year source key | 保留 | 不變（改由 worker 讀取同一檔案） |
| 私有 immutable checkpoint Release 擁有持久化資料（ADR-0001 Compatibility Boundary） | 取代 | volume 上的 canonical generation 與備份集（§5.2、§7.7）；既有 Releases 改為遷移來源與歷史證據 |
| 失敗的 attempt 是獨立的 forensic 封存，不能作為還原基礎 | 保留語意 | `/data/attempts/`（R-OPS-03） |
| `apps/data` 擁有一次性的 import／acceptance／export；PG 只是暫時性工具 | 取代 | `apps/data` 的指令保留，儲存改為 SQLite；PG 只出現在 legacy 工具 image |
| ADR-0001 Retirement Impact：「Retain PostgreSQL migrations, archival acceptance and differential test oracle」 | 取代 | migrations 於 P5 後封存；archival acceptance 移植到 SQLite；差異 oracle 改為凍結的 golden fixture（§10） |
| 正規化並加上索引的 SQLite 擁有公開查詢（schema 3） | 保留 | 查詢改在 server 執行 |
| ADR-0001：「Browser queries execute … sql.js-httpvfs … No HTTP API … survives」 | 取代（D5） | `apps/server` `/api/v1` |
| ADR-0001 Retirement Impact：「Delete Fastify/server workspace, application Docker carriers, resident cron scheduler」 | 因本次需求變更而刻意重新引入 | 新的 `apps/server`、Dockerfile 與 worker 排程；不恢復 PostgreSQL、S3、MinIO 依賴 |
| `publish.yml` 是單一排程 publisher | 取代（D3） | worker 搭配 writer lock（§6.3） |
| GitHub Pages 提供公開網站 | 取代（D6） | `web` 容器 |
| 審閱圖片存放在私有 immutable media Release，publication 時校驗 | 取代傳輸方式，保留 gate（D9） | `media import` 與本機 object store |
| 網站 rollback 會部署含 UI 的完整 immutable site；schema 2 site 可讀 | 拆成三條回復路徑（§6.7） | release rollback、image rollback、舊 site 封存的緊急復原 |
| 可讀的 entity／era URL key 有持久化的 scoped ownership；後到者不能搶走已發布的 ID | 保留 | SQLite canonical 加上 trigger（§7.3） |
| 分享、保存比較與匯出屬於 client 功能 | 保留 | 不變；資料改由 API 提供 |

核准後，P1 要建立 **ADR-0002（Docker／SQLite 自主部署）**，逐條取代上表中標為「取代」或「重新引入」的 ADR-0001 條款，並寫明新的相容契約與退場時點。ADR-0001 的 facts provider、媒體權利與生成頭像決策維持不變。P5 完成後，另建新的 baseline 記錄實測狀態。

## 5. 目標架構

### 5.1 元件

```text
┌──────────────────────────── Docker host（單一主機、本機磁碟） ────────────────────────────┐
│ worker（riftversus:<sha> `worker`）                                                     │
│   排程或手動觸發 → 取得 writer lock → 複製 canonical 為 candidate                       │
│   → sync → export → acceptance → smoke → fsync → state.json 原子切換 → 備份             │
│                                                                                         │
│ volume /data                                                                            │
│   db/generations/<seq>.sqlite（promote 後不再修改）   db/candidates/<runId>/            │
│   releases/<releaseId>/{snapshot.sqlite, manifest.json, media/, presentation/}         │
│   state/current.json（唯一 commit 點）   state/scheduler.sqlite                         │
│   objects/<sha256>   backups/   attempts/   locks/                                      │
│                                                                                         │
│ web（riftversus:<sha> `serve`，/data/releases 與 /data/state 唯讀掛載）                  │
│   GET / (SPA)  /api/v1/*  /r/<releaseId>/media/*  /r/<releaseId>/presentation/*         │
└───────────────────────────────────▲─────────────────────────────────────────────────────┘
                                    │ 使用者 → reverse proxy（TLS）
```

### 5.2 資料生命週期與唯一 commit 點

- **R-ARCH-01 canonical generation**：
  - 每個已 promote 的 canonical DB 存為 `db/generations/<seq>.sqlite`，promote 後即不可變。
  - 每次發布 run 開始時，以 SQLite backup API 把目前的 generation 複製成 `db/candidates/<runId>/candidate.sqlite`，所有寫入只發生在這份 candidate 上。
  - 因此，未通過驗收的寫入不會殘留在任何已 promote 的 generation 中。
- **R-ARCH-02 release**：
  - `releases/<releaseId>/` 是不可變的公開成品，其中 `snapshot.sqlite` 的權限為 `0444`。
  - `snapshotId` 是邏輯資料投影的 digest，沿用 `snapshotDigest`。由於它包含帶 base path 的媒體 URL，base path 改變時 `snapshotId` 也會改變。
  - `releaseId` 是 `manifest.json` 正規化內容的 sha256，涵蓋 `snapshotId`、`snapshot.sqlite` 的 checksum、schema 版本、exporter 版本（image revision）、`basePath`，以及所有媒體檔案的 checksum。
  - 目錄以 `releaseId` 命名，避免出現「邏輯內容相同、成品不同」的路徑衝突。
- **R-ARCH-03 唯一 commit 點**：
  - `state/current.json` 記錄 `{ generation, releaseId, snapshotId, previous: {generation, releaseId}, promotedAt, runId }`。
  - promote 步驟如下：
    1. 確認 candidate DB、release 目錄與新物件都已 fsync（含目錄）。
    2. 把 candidate 改名為 `db/generations/<seq+1>.sqlite`。
    3. 寫入 `current.json` 的暫存檔並 fsync。
    4. 以 rename 取代 `current.json`，再 fsync 所在目錄。
  - 第 4 步的 rename 是唯一的 commit 點：
    - rename 之前發生任何失敗，都會丟棄 candidate。
    - 已改名但尚未被 `current.json` 引用的 generation，會在下次啟動時被視為孤兒並移除，不會成為發布狀態。
- **R-ARCH-04 commit 後的步驟**：
  - 備份（R-DATA-50）與對外驗證（R-OPS-07）在 commit 之後執行。
  - commit 前資料已在本機持久化，所以這兩步失敗時只告警並記錄，不會回滾已 commit 的狀態。
  - 「current 維持原狀」的保證只適用於 commit 之前的步驟。
- **R-ARCH-05 查詢語意單一 owner**：
  - `@riftversus/domain` 的 SQLite schema v3 與 `searchSqlite`／`compareSqlite` 維持不變。
  - 執行環境從瀏覽器的 `sql.js` 改為 server 端的 `node:sqlite`（`SqliteExecutor` 介面已存在）。
  - web 不開啟 canonical DB，因此不會有跨容器共用 WAL 的情況。

### 5.3 Workspace 調整

| Workspace | 變更 |
| --- | --- |
| `packages/contracts` | 新增 API envelope、錯誤碼、release identity、單局明細與統計拆解等 schema（皆為 additive） |
| `packages/domain` | 保留 schema v3 與既有查詢；新增單局明細與統計拆解查詢。若需變更 schema 而升為 v4，web 必須同時支援讀取 v3（§6.7） |
| `packages/database` | P1–P4 在 PG 實作旁新增 SQLite 實作；PG 路徑凍結（只修 bug），讓 `publish.yml` 繼續使用；P5 移除 PG 實作與 `pg` 依賴 |
| `packages/sync` | 保留 Leaguepedia provider 與 filesystem object store；鎖改由呼叫端注入 |
| `apps/data` | 保留 sync、acceptance、export、mapping、freshness；新增 `run`、`release *`、`backup *`、`media import`、`legacy *`；P5 讓 GitHub publish、site、archive、checkpoint-release 指令退場（§10） |
| `apps/server`（重建） | HTTP server、API、靜態檔、release 熱切換、`worker` 排程入口 |
| `apps/web` | 新 UI；以 `http-runtime` 取代 `static-runtime`；保留 `mock-runtime` 供測試使用 |

## 6. 部署需求（Docker）

### 6.1 Production image

- **R-DEP-01**：根目錄的 `Dockerfile` 採多階段建置：
  - `deps`：`pnpm fetch`，搭配 `--frozen-lockfile`。
  - `build`：執行 `pnpm build` 並產生 web bundle。
  - `runtime`：`pnpm deploy --prod`。
  - 另有 `legacy-tools` target（§7.6），不屬於 production image。
- **R-DEP-02**：runtime base 為 `node:24-bookworm-slim`，以 digest 鎖定 Node 小版本；以非 root（UID/GID `10001`）執行；`tini` 作為 PID 1；`NODE_ENV=production`。
- **R-DEP-03**：production image 不得包含任何 secret、`.env`、PostgreSQL client 或 Chromium。secret 只在 runtime 以 env file 注入，不得出現在 build arg、`ENV` 預設值或 config summary 中。
- **R-DEP-04**：必須能在 `read_only: true` 的 rootfs 下執行，只有 `/data`（worker）與 `/tmp`（tmpfs）可寫。`riftversus init` 在空白 volume 上以 UID 10001 建立目錄結構，權限不正確時拒絕啟動。
- **R-DEP-05**：OCI labels 包含 `org.opencontainers.image.revision`、`version`、`source`；`riftversus version` 輸出相同的資訊。
- **R-DEP-06**：單一 entrypoint `riftversus <command>`；同一個容器不得同時執行 `serve` 與 `worker`。
- **R-DEP-07**：資源預算如下，P2 實測後寫入證據，超出時須在 PR 中說明：
  - 未壓縮 image ≤ 300 MB。
  - web 閒置 RSS ≤ 150 MB。
  - worker 閒置 RSS ≤ 150 MB；sync 期間的峰值 RSS 須另行記錄。

### 6.2 Compose、設定與 base path

- **R-DEP-10**：`compose.yaml` 包含以下服務與 profile：
  - `web`：執行 `serve`，對外 port 為 `127.0.0.1:${WEB_PORT:-8080}:8080`；`/data/releases` 與 `/data/state` 唯讀掛載；healthcheck 為 `riftversus healthcheck web`。
  - `worker`：執行 `worker`，`/data` 可讀寫；healthcheck 為 `riftversus healthcheck worker`。
  - `legacy-import` profile：`postgres:17` 搭配 `riftversus-legacy-tools` image，P5 移除。
  - MinIO 的 `legacy-recovery` profile：P5 移除，named volume 一律保留。
- **R-DEP-11**：`web` 與 `worker` 都使用 `${RIFTVERSUS_IMAGE:-riftversus:local}`，部署證據須記錄兩者的 image ID 相同。此約束不適用於 legacy profile。
- **R-DEP-12**：設定只來自環境變數，`.env.example` 依下列方式重寫：
  - 新增：`PUBLIC_BASE_PATH`、`PUBLIC_ORIGIN`、`DATA_DIR=/data`、`WORKER_SCHEDULE`、`SYNC_CURRENT_CRON`、`SYNC_HISTORY_CRON`、`SYNC_RUN_TIMEOUT_MINUTES=180`、`BACKUP_RETAIN=14`、`ALERT_WEBHOOK_URL`（可選）。
  - 保留：Leaguepedia 與 sync 參數，以及現有拒絕範例 domain 的機制。
  - 移除：`DATABASE_URL` 與 S3／MinIO 變數。legacy 專用變數另外分區標示。
- **R-DEP-13**：SQLite 檔必須放在本機區塊儲存上的 Docker volume 或 bind mount，不支援 NFS、SMB 或雲端同步資料夾。worker 啟動時若偵測到網路檔案系統，即拒絕啟動。web 與 worker 必須在同一台主機上。
- **R-DEP-14 runtime base path**：
  - web bundle 不得在 build 時寫死 base path。server 回應 `index.html` 時注入 `<base href>` 與 runtime config，Router 的 `basename` 與資產 URL 都從 runtime config 取得。具體實作在 P2 決定。
  - worker 匯出時把 `PUBLIC_BASE_PATH` 寫入 release manifest。web 遇到 manifest 的 `basePath` 與自身設定不符時拒絕載入（fail closed，並由 `/readyz` 回報錯誤）。
  - 驗收：同一個 image 在 `PUBLIC_BASE_PATH=/` 與 `PUBLIC_BASE_PATH=/RiftVersus/` 兩種設定下都通過 E2E。
- **R-DEP-15 舊前綴正規化**：
  - 只有在 `PUBLIC_BASE_PATH` 不是 `/RiftVersus/` 時，才把 `/RiftVersus/*` 以 308 導向 `${PUBLIC_BASE_PATH}*`，並保留 query。
  - 不得產生導向迴圈，需有測試涵蓋。

### 6.3 單一 writer、排程狀態與 run 對帳

- **R-DEP-20 鎖範圍**：
  - 所有寫入 `/data` 的指令，都要先取得 `/data/locks/writer.lock` 的獨占 `flock`，並一直持有到 commit 與 commit 後的步驟結束。這些指令包括：`run current`／`history`／`backfill`／`media`、`migrate`、`release promote`／`rollback`、`backup restore`、`media import`、`init`。
  - candidate DB 的寫入交易使用 `BEGIN IMMEDIATE`。
  - 行程被強制終止時，kernel 會自動釋放 flock。
- **R-DEP-21 手動與排程的差異**：
  - 手動 CLI 取不到鎖時，立即以 `status: locked` 結束並回傳非零 exit code，不排隊等待。
  - 排程觸發時如果鎖被佔用，就在 `state/scheduler.sqlite` 記錄一筆 `pending`。每種 run kind 最多保留一筆 pending，新的取代舊的，與 Actions concurrency 只保留最新一筆等待中 run 的行為一致。鎖釋放後由 worker 接手執行。
- **R-DEP-22 排程狀態持久化**：
  - `state/scheduler.sqlite` 記錄每次排程的 `scheduledFor`（UTC）、kind、runId、狀態（`pending|running|succeeded|failed|abandoned|timed_out`），以及開始與結束時間。
  - 補跑規則：worker 啟動時，每個 kind 最多補跑一次，對象是最近一次錯過的 `scheduledFor`，而且它必須晚於該 kind 最後一次成功或失敗的 run。更早錯過的排程不補跑。
- **R-DEP-23 逾時與強制終止**：
  - run 超過 `SYNC_RUN_TIMEOUT_MINUTES` 時，先以 `AbortSignal` 中止，60 秒寬限期後強制結束，標記為 `timed_out`，並丟棄 candidate。
  - worker 啟動時，凡是狀態為 `running` 但沒有任何行程持有鎖的 run，一律標記為 `abandoned`，並移除 `db/candidates/<runId>/`、未被引用的 release staging 與孤兒 generation。這類 candidate 永遠不得被 promote，需有測試涵蓋。
- **R-DEP-24 連線設定**：
  - 每個連線設定 `foreign_keys=ON` 與 `busy_timeout=5000`。
  - candidate 寫入期間使用 `journal_mode=WAL` 與 `synchronous=NORMAL`。
  - promote 前執行 `wal_checkpoint(TRUNCATE)`，把 journal mode 切回 `DELETE` 並 fsync，讓 generation 成為單一檔案。

### 6.4 Actions 功能的新 owner

| 現行 Actions 提供 | 新 owner | 需求 |
| --- | --- | --- |
| `schedule` cron | worker 排程（D3） | R-DEP-22 |
| `concurrency` 單一 writer，以及一筆等待中的 run | writer lock 與 pending 合併 | R-DEP-20、R-DEP-21 |
| `timeout-minutes: 180` | `SYNC_RUN_TIMEOUT_MINUTES` | R-DEP-23 |
| 失敗 attempt 封存 | `/data/attempts/` | R-OPS-03 |
| 失敗通知 | `scheduler.sqlite`、freshness、webhook | R-OPS-04 |
| secrets／vars 注入 | runtime env file | R-DEP-03 |
| `workflow_dispatch` 各 mode | CLI（§6.5） | — |
| 每次從 checkpoint 全新還原 | 每次 run 從已 promote 的 generation 建立 candidate，並定期做重建驗證 | R-ARCH-01、R-OPS-05 |
| 候選網站的瀏覽器驗證 | promote 前的 smoke（D8） | R-OPS-06 |
| 部署後的身分驗證與 hosted smoke | promote 後的對外驗證 | R-OPS-07 |

- **R-OPS-03 attempt 封存**：
  - 每個失敗、逾時或 abandoned 的 run 都寫入 `attempts/<runId>/`，內容包括：
    - `manifest.json`：kind、request、失敗階段、錯誤摘要、image revision、使用的 generation。
    - diagnostics。
    - 失敗輸入：本次取得的 raw source 物件。這些物件由 attempt 釘住引用，在保留期內不會被物件 GC 清除。
  - 最多保留 30 筆，每筆至少保留 30 天。
  - attempt manifest 的 `type` 為 `attempt`。`backup restore` 與 `release promote` 遇到 `type` 不是 `backup`／`release` 的輸入時一律拒絕，需有測試涵蓋。
  - `riftversus attempt show <runId>` 可在保留期內重讀失敗證據。
- **R-OPS-04 通知**：
  - 以下情況會觸發通知：run 失敗、逾時、abandoned，freshness 不健康，或 commit 後的步驟失敗。
  - 若設定了 `ALERT_WEBHOOK_URL`，就 POST 一筆不含 secret 的 JSON。
  - worker healthcheck 也會反映 freshness 狀態。
- **R-OPS-05 重建驗證**：
  - 每週 history 結束後執行 `release rebuild --verify`：從 `current.json` 記錄的 generation 重新匯出，`snapshotId` 與 `releaseId` 必須和該 generation 當初產生的 release 相同。
  - 比對基準是 generation 與 release 的配對，而不是最新的 canonical，所以 rollback 後的狀態也能正確驗證。
  - 不一致時告警，且不得自動 promote。
- **R-OPS-06 promote 前 smoke**：對候選 release 啟動 in-process server，驗證下列項目：
  - `meta`。
  - 預設比較，以及 acceptance fixture（T1 vs LPL Worlds BO5）。
  - 搜尋與單局明細。
  - manifest 列出的所有媒體，以及 image credits。
- **R-OPS-07 promote 後對外驗證**：
  - commit 後 90 秒內經 `PUBLIC_ORIGIN` 呼叫 `/api/v1/meta`，回傳的 `releaseId` 必須等於新 release。最多重試 15 次、每次間隔 2 秒，與現行 `verifyDeployedIdentity` 相同。
  - 同時抽查媒體、credits 與 CSP header。
  - 驗證失敗時告警並寫入 attempt，回復方式是依書面步驟執行 `riftversus release rollback`。
  - 不自動 rollback，因為 proxy 或網路問題無法靠 rollback 解決。

### 6.5 指令對照

| 現行 | 新指令（皆在同一 production image） |
| --- | --- |
| `publish.yml` mode `current` | 排程，或 `riftversus run current` |
| mode `history` | 排程，或 `riftversus run history` |
| mode `backfill` | `riftversus run backfill --year YYYY --competition NAME` |
| mode `media` | 先 `riftversus media import <pack>`，再 `riftversus run media` |
| mode `reexport`／`rebuild` | `riftversus release rebuild [--verify]` |
| mode `rollback` | `riftversus release rollback [<releaseId>]`、`release list` |
| `checkpoint pack|verify|restore` | `riftversus backup create|verify|restore` |
| `migrate` | `riftversus migrate`（SQLite canonical） |
| —（新增） | `riftversus attempt list|show`、`init`、`healthcheck` |
| —（遷移專用，在 legacy 工具 image） | `riftversus-legacy import-postgres`、`parity` |

`run <kind>` 的管線如下，全程持有 writer lock：

1. 取得鎖。
2. 從 current generation 建立 candidate。
3. sync 在 candidate 中寫入新的 publication generation；`media` 只寫入媒體。
4. 匯出 release 到 `releases/.staging-<runId>/`。
5. 對匯出結果執行 acceptance。沿用 `current-snapshot-acceptance`，它會讀取匯出的 SQLite 與物件。
6. `release verify` 與 smoke。
7. fsync，把 staging 改名為 `releases/<releaseId>/`。
8. commit（R-ARCH-03）。
9. 備份。
10. 對外驗證。

第 1 到 8 步中任何一步失敗，都會丟棄 candidate 與 staging、寫入 attempt，`current.json` 不會改變。

- **R-OPS-08 多批 history**：同一個 run 內若有多個 history request，只要任一 request 失敗，整個 candidate 就丟棄，所有失敗原因寫入同一份 attempt。這與現行 `AggregateError`（「do not promote this candidate」）的語意相同。
- **R-OPS-09 media-only**：`run media` 只能新增或更新媒體 metadata 與物件，不得修改 facts、名單、覆蓋率或 freshness。實作方式是比對 candidate 與前一個 generation：非媒體表只要有任何差異就 fail closed。

### 6.6 升級

- **R-DEP-30**：升級步驟依序為 `docker compose build`（或 `pull`）→ `docker compose run --rm worker migrate` → `docker compose up -d`。
  - `migrate` 以 current generation 為輸入產生新的 generation，必須持有鎖，執行前自動建立備份集。
  - worker 偵測到有尚未執行的 migration 時，拒絕啟動排程。

### 6.7 回復路徑與相容矩陣

- **R-DEP-40 release rollback**：
  - `release rollback [<releaseId>]` 把 `current.json` 指向一個仍在保留中的 release 及其 generation，不更動 image。
  - 後續的 run 從選定的 generation 繼續。
  - 被跳過的 generation 會保留在 `db/generations/`，直到 prune 才移除。
- **R-DEP-41 image rollback**：
  - 可以回到前一個 image tag。若新 image 已執行過 migration，必須先以 `backup restore` 還原到 migration 前的備份集。
  - migration 之後寫入的 generation 會因此遺失。這是可接受的，因為 facts 可以從保留的 raw source 物件與上游重播，以 `run history`／`backfill` 重建。
  - 這項取捨要寫入 ADR-0002。
- **R-DEP-42 相容矩陣**：
  - image N 必須能讀取 release schema v3，以及 N 自己引入的任何新 schema。
  - image N 必須能讀取 image N-1 產生的 release。
  - image N-1 讀到不支援的 schema 時，必須拒絕載入，不得錯誤顯示。
  - P2 與每次 image 升級時，都要演練「N-1 image 搭配 N 產生的 release」與「N image 搭配 N-1 產生的 release」兩種組合。
- **R-DEP-43 舊靜態 site 封存**：
  - 私有 Release 中的 schema 2／3 immutable site，在 P5 後轉為歷史證據。
  - cutover 後 30 天內，必須保留可執行的書面緊急復原程序：以 Pages 重新部署封存的 site，並把 DNS 或遷移頁指回 Pages。
  - 30 天後，由 ADR-0002 明確取消「schema 2 site 可 rollback」的契約。

## 7. 資料需求（SQLite）

### 7.1 Canonical schema

- **R-DATA-01**：以單一 SQLite baseline migration `sqlite/001_baseline`，重建 PG migration 001–014 的最終狀態，共 21 張表。表名、欄位與約束語意皆須與 PG 等價：

  ```text
  coverage_status, dataset_versions, entities, entity_aliases, entity_public_ids,
  fact_mutation_audits, fact_mutation_authorizations, game_facts, game_players,
  media_assets, media_objects, override_application_runs, override_applications,
  series_facts, source_cursors, source_objects, sync_runs, team_era_public_ids,
  team_eras, team_region_history, tournaments
  ```

  P5 之前，PG migrations 保留在原位，供舊發布路徑使用。
- **R-DATA-02**：所有表都使用 `STRICT`，並移植全部的 CHECK、UNIQUE 與 FK。

### 7.2 型別與功能差異

| PG 功能（使用處） | SQLite 處理 | 驗收 |
| --- | --- | --- |
| `ilike` 搜尋（`repositories/entities.ts`） | 寫入時另存 `*_fold` 欄位（NFKC 加 Unicode lowercase，由 app 計算）；查詢時比對 fold 欄位，使用 `=` 或 `LIKE … ESCAPE '\'`。SQLite 的 `LIKE` 只對 ASCII 字元不分大小寫，不得直接用在原始欄位上 | 測試韓文、中文、全形字元，以及含 `%`、`_` 的名稱 |
| `pg_trgm`（migration 008） | 不移植。若量測顯示需要子字串索引，改用 FTS5 `trigram`（已確認 Node 24.12 內建的 SQLite 3.50.4 可用） | 搜尋延遲的量測證據 |
| advisory lock（`repositories/sync.ts`） | writer lock（R-DEP-20） | 併發 run 回傳 `locked`；排程 pending 合併 |
| PL/pgSQL trigger 與交易本地授權 | 見 §7.3 | 見 §7.3 |
| `jsonb` | `TEXT`，加上 `CHECK (json_valid(col))`；以穩定的鍵序序列化 | round-trip 測試；parity 正規化 |
| `date`（`parsePostgresDateText`） | `TEXT`，以 GLOB CHECK 限制為 `YYYY-MM-DD`，應用層再以 `DateSchema` 驗證 | 沿用既有的日期邊界測試 |
| `timestamptz` | `TEXT`，ISO-8601 UTC 毫秒格式（結尾為 `…Z`） | 時區與排序測試 |
| `boolean` | `INTEGER`，加上 `CHECK (col IN (0,1))` | — |
| `bigint`（含 migration 002 的 generation sentinel `9223372036854775807`） | `INTEGER`（64-bit）。generation 類欄位一律以 `BigInt` 讀取（`node:sqlite` 用 `setReadBigInts`，其他驅動用對應設定），不得轉成 `Number`；其他欄位超出 `MAX_SAFE_INTEGER` 時 fail closed | sentinel round-trip；parity 以十進位字串比較 |
| `uuid` | `TEXT`，加上格式 CHECK | — |
| `FOR UPDATE`／交易隔離 | 單一 writer 下 SQLite 即為 serializable | — |
| `pg_dump`／`pg_restore` | 備份集（§7.7） | 還原演練 |

- **R-DATA-03 驅動選擇**：
  - 優先使用 Node 內建的 `node:sqlite`（export 已在使用），並為 Kysely 撰寫 dialect adapter。
  - 若 P1 驗證發現相容性、交易、BigInt 或效能有不足，改用 `better-sqlite3`。最終選擇由 P1 PR 以測試證據決定。
  - `node:sqlite` 在 Node 24 仍標示為 experimental，因此必須鎖定 Node 小版本，每次升級都要跑完整測試。

### 7.3 寫入保證（取代 PL/pgSQL）

PG 以 trigger 搭配 `txid_current()`／`pg_backend_pid()` 的交易本地授權，保證每次修改 canonical facts 都有 provenance，並留下稽核紀錄。SQLite 版本必須提供等價的保證：

- **R-DATA-10 事實修改授權**：
  - `series_facts`、`game_facts` 等 canonical fact 表的 `UPDATE`，由 main schema 的 `BEFORE UPDATE` trigger 檢查。同一個交易內必須存在一筆 `fact_mutation_authorizations` 授權列，`state` 為 `active`，且 `fact_table`、`fact_id`、`provenance_kind`、`provenance_id` 全部吻合；否則以 `RAISE(ABORT)` 拒絕。
  - 授權列只能由唯一的寫入 API `authorizeFactMutation` 在同一交易內插入。trigger 檢查通過後，把該列標記為 `consumed`，並寫入 `fact_mutation_audits`。
  - commit 前，寫入 API 必須斷言沒有殘留的 `active` 授權列，否則整筆交易 rollback。
  - provenance 必須存在於 `source_objects` 或 `override_applications`。
  - 內容完全不變的 UPDATE 直接放行，與 PG 的 `is not distinct from` 行為一致。
- **R-DATA-11 歷史授權紀錄**：從 PG 匯入的 `fact_mutation_authorizations` 與 `fact_mutation_audits` 歷史列，原樣保存在 `legacy_transaction_id`／`legacy_backend_pid` 欄位，標記為 `state='historical'`，不參與執行期的授權判斷。
- **R-DATA-12 不可變 public ID**：
  - 對 `entity_public_ids`、`team_era_public_ids` 的 `UPDATE`、`DELETE`，以及把已發布的 ID 改綁到其他主體的寫入，都由 trigger 以 `RAISE(ABORT)` 拒絕。
  - entity kind 與 era scope 的一致性也由 trigger 檢查。
- **R-DATA-13 拒絕測試**：PG integration suite 中所有「非法寫入必須被拒絕」的測試，都要移植到 SQLite 並通過。例如：未授權修改 fact、偽造 provenance、搶走 public ID、kind 不符。
- **R-DATA-14 publication generation 與 gate**：
  - 保留 `dataset_versions`（append-only）與 publication generation 的語意。
  - source correction、alternative game review、identity overrides 的載入方式與 checksum 維持不變。
  - 既有的 fail-closed gate 不得放寬，包括：mapping 缺漏、redirect 目標缺少 player dimension、BO2／格式證據、partial coverage、awarded score。這些測試都要在 SQLite 上通過。

### 7.4 Release 成品

- **R-DATA-20**：`releases/<releaseId>/` 包含以下內容：
  - `snapshot.sqlite`：schema v3，或經核准的新 schema。
  - `manifest.json`：`releaseId`、`snapshotId`、`schemaVersion`、各檔案的 sha256 與 bytes、`basePath`、`datasetVersion`、`coverage`、`generation`、`runId`、`imageRevision`、`createdAt`。
  - `media/`：有 license 的媒體、具 editorial rights basis 的審閱媒體，以及 deterministic v2 avatar。
  - `presentation/image-credits.html`：列出每張圖片的來源、rights basis 與 attribution。
- **R-DATA-21**：`snapshotId` 的計算方式不變。匯出必須是決定性的：相同的 generation、`basePath` 與 exporter 版本，一定產生相同的 `snapshotId` 與 `releaseId`。
- **R-DATA-22**：`release prune` 保留以下 release 及其對應的 generation：最近 10 個 release、`current` 與 `previous`、過去 24 小時內曾作為 current 的 release（§8.4）。

### 7.5 媒體

- **R-DATA-30**：發布資格沿用 ADR-0001 及其 2026-10-04 amendment：
  - 有 license 的媒體可以發布。
  - `license=null` 的媒體，必須具備結構化的 editorial rights basis，並齊備 file page/revision、經審閱的 checksum、rights statement、attribution，以及精確的 player／team-era 綁定。
  - 圖片內容一旦變更，就不得沿用舊的審閱結果。
  - region 一律使用生成頭像。
  - 其他上游媒體一律 fail closed。
- **R-DATA-31**：`media import <pack>` 會驗證以下項目，全部通過才寫入 `objects/`；任一項失敗就拒絕整包：
  - 整包 checksum。
  - 逐檔 checksum 與大小上限。
  - MIME 類型與圖片尺寸。
  - manifest 中每個主體綁定都存在於 canonical。
  - credits 欄位完整。
- **R-DATA-32**：deterministic avatar 在 export 時才生成，屬於呈現輸出，不寫入 `media_objects`，也不作為 provenance（ADR-0001）。

### 7.6 一次性遷移與 cutover 交接

- **R-DATA-40 legacy 工具 image**：
  - 由 `Dockerfile` 的 `legacy-tools` target 建置，內含 `postgresql-client-17` 與 PG 版的 `apps/data`，只在 `legacy-import` profile 中搭配 `postgres:17` 使用。
  - 提供三個指令：`legacy fetch-checkpoint`、`legacy import-postgres`、`legacy parity`。
  - 下載 checkpoint 需要 `RIFTVERSUS_DATA_TOKEN`，只在執行當下以環境變數注入。
- **R-DATA-41 匯入範圍**：
  1. 在 PG 17 還原 checkpoint 的 dump。
  2. 依 FK 拓撲順序，把 21 張表複製到新的 SQLite generation 1。
  3. 把 checkpoint 內的所有物件（raw source，以及 retained／reviewed media）匯入 `objects/`，並與 `source_objects`、`media_objects` 對帳 key、sha256、大小與類型：每筆 DB 參照都必須有對應物件，每個物件也必須有參照或列在白名單中。
  4. 匯入私有 media Release 中被引用的審閱位元組，套用與 `media import` 相同的驗證。
- **R-DATA-42 parity gate**（以下條件必須全部成立）：
  - 分別以 PG 路徑與 SQLite 路徑匯出 release A 與 B，使用相同的 `basePath`（目前部署的 `/RiftVersus/`）與相同的 exporter 版本，結果須滿足 `snapshotId(A) == snapshotId(B)`。
  - 每張表的 row count 相等。
  - 每張表依主鍵排序並正規化後（JSON 鍵序、時間格式、BigInt 轉十進位字串），sha256 相等。
  - `entity_public_ids` 與 `team_era_public_ids` 完全一致，且 legacy UUID 與 readable 分享連結都解析到相同主體。
  - 物件對帳沒有缺漏。
  - 在乾淨的 volume 上，用遷移結果執行完整的 current snapshot acceptance、archival acceptance（§10）、來源與歷史結果驗收，以及媒體與 credits 驗收，全部通過。
  - 若目前部署的 Pages site 來自同一份 checkpoint，`snapshotId(B)` 必須等於該 site manifest 中的 `snapshotId`。
- **R-DATA-43 base path 切換**：parity 通過後，以新的 `PUBLIC_BASE_PATH` 重新匯出。驗收時只允許帶 base path 的 URL 欄位不同；把兩邊的 URL 前綴正規化之後，`snapshotDigest` 必須相等。
- **R-DATA-44 shadow 與正式 volume 分離**：P3 的 shadow run 使用獨立的 `riftversus-shadow` volume，資料來源是當時最新的 checkpoint。shadow 資料只用於驗證，永遠不會成為正式資料。
- **R-DATA-45 cutover 交接順序**（必須依序執行，每一步都留存證據）：
  1. 盤點本機已驗證、但尚未經 Actions 發布的資料：比較本機 snapshot 與目前部署 site 的 `snapshotId` 與 scope。若有差異，先透過現行 Actions 發布。若無法發布，就列出需要在新 worker 以 `run history`／`backfill` 重播的 scope 與驗收數量（每個 scope 的 series 數與 game 數），列為 cutover 後的必做項目。
  2. 把 repo variable `PUBLISH_ENABLED` 設為 `false`，並確認沒有排隊中或執行中的 `publish.yml` run，也沒有進行中的 Pages deployment。
  3. 以 `archive resolve` 鎖定最後一份 verified checkpoint，記錄其 ID、sequence 與 series 數。
  4. 在正式 volume 上，以這份 checkpoint 重新執行 R-DATA-41 到 R-DATA-43。
  5. 啟用 web 與 worker 的排程，並完成 R-OPS-07 對外驗證。
  6. 部署 Pages 遷移頁（§8.6）。
  - 在步驟 2 到 5 之間，若需要退回舊路徑，只要把 `PUBLISH_ENABLED` 改回 `true` 即可，因為在此之前沒有修改任何舊資料。

### 7.7 備份集

- **R-DATA-50 `backup create`**：
  1. 以 SQLite backup API 複製 current generation。
  2. 執行 `PRAGMA integrity_check` 與 `foreign_key_check`。
  3. 寫入 `manifest.json`（`type: backup`），記錄 generation、DB sha256、所有被引用物件的 hash 清單、current `releaseId`、image revision 與 schema 版本。
  4. 以內容定址的方式，把物件增量複製到 `backups/objects/<sha256>`。
  5. fsync 後改名為 `backups/<timestamp>-g<generation>/`。
  - 任何一個備份集加上 `backups/objects/`，就足以在沒有 `/data` 的情況下獨立還原。
- **R-DATA-51 異地保存範圍**：
  - 必須同步整個 `backups/`，包括 `backups/objects/`。
  - 物件 GC 只能刪除未被任何保留中的備份集、release、generation 或 attempt 引用的物件。
- **R-DATA-52 `backup restore <set>`**：
  1. 取得 writer lock。
  2. 在 staging 中驗證 DB checksum、`integrity_check`、FK，以及所有被引用物件的存在與 checksum。
  3. 以該備份重新匯出 release，並確認 `snapshotId` 與 manifest 的紀錄一致。
  4. 把現有的 `state/` 與 generation 等檔案移到 `backups/pre-restore-<ts>/`，不得直接覆寫。
  5. 更新 `current.json`（唯一的 commit 點）。
  - web 透過熱切換載入新的 release，不需要重啟。
- **R-DATA-53 演練**：在一台只有異地副本的乾淨主機上執行 `init` → `backup restore` → `serve`，必須重現相同的 `snapshotId`。

## 8. 前端需求（UI 重設計）

### 8.1 必須保留的使用者契約

重設計時可以改寫測試的 selector，但不得刪除任何行為斷言。

| 契約 | 現有證據 |
| --- | --- |
| URL 狀態參數 `leftKind/leftId/leftEraId/rightKind/rightId/rightEraId/from/to/events/leagues/bestOf` 的名稱與語意不變。legacy UUID 連結會 canonicalize 成 readable ID，並保留篩選條件；未知的 readable ID 保留在 URL 上，並顯示復原提示；無效的狀態以 canonical 預設值取代 | `app.test.tsx` 中 readable、legacy、unknown、invalid route 的案例 |
| 預設比較：T1 vs LPL、2019-01-01–2026-12-31、Worlds、BO5 | `model.ts` `defaultRouteState`、`test/default-comparison.test.ts` |
| 保存、載入、刪除比較；localStorage key 為 `riftversus.saved-comparisons`，格式 version 2 | `storage.ts`、`storage.test.ts`、`app.test.tsx` |
| PNG 與多頁 ZIP 匯出：每頁都含可解碼的可見像素；分頁不重排；不混用不同 release 或不同篩選的頁面；最多 1000 列；BO2 平手不算敗場；標示單局不完整；圖片載入失敗時改用 placeholder | `export-result.test.ts`、`ExportButton.test.tsx`、E2E 匯出 |
| player 顯示為 `ID (真名)`；比較列顯示歷史隊名與 team-era 標籤；摘要保留選定的主體 | `app.test.tsx` 中摘要與比較列的案例 |
| coverage warning、`單局明細不完整`、BO2 `DRAW` | 同上 |
| Combobox ARIA：`role=combobox`、`aria-expanded`、`aria-activedescendant`；鍵盤上下鍵、Enter、Escape；blur 時還原；沒有選項時 Enter 不送出 | `app.test.tsx` 中 combobox 的案例 |
| 圖片來源與權利聲明頁 | footer、`presentation/image-credits.html` |
| cursor 分頁（每頁 50 列） | `app.test.tsx` 中分頁的案例 |
| 手機寬度下不會出現水平捲動 | E2E mobile（目前測 390px） |

勝率定義沿用 domain：`winRate = wins / total`，其中 `total` 包含 draws。

### 8.2 設計方向

- **主題概念**：「轉播計分板」。比較雙方各有一個側色，在總覽、賽果列與圖表中保持一致：左方為藍色 `--side-a`，右方為紅色 `--side-b`，呼應峽谷的藍紅兩方。資料密度高，但層次清楚；數字一律使用 tabular numerals。
- **字型**：UI 內文使用 `Noto Sans TC`，比分與大型數字使用 `Barlow Condensed`。兩者都是 OFL 授權，以 `woff2` 格式自行託管，不使用外部 CDN。CJK 字型必須做子集化，以 `unicode-range` 分片並設定 `font-display: swap`；首屏的字型下載量不超過 400 KB。
- **Design tokens**：以 `:root` 的 CSS custom properties 定義，包括：
  - 色彩：背景、表面、文字、muted、線條、accent、side-a、side-b、win、loss、draw、warning。
  - 間距：以 4px 為基準。
  - 圓角、陰影與字級階層。
- **主題切換**：預設跟隨 `prefers-color-scheme`，使用者可手動選擇亮色、暗色或跟隨系統，偏好存在 localStorage。兩種主題都必須達到 WCAG 2.2 AA 對比標準。側色在兩種主題下都要能與 win／loss 色區分，並搭配文字或圖示，不只靠顏色辨識。
- **樣式技術**：使用純 CSS，按元件拆分檔案並引用 tokens，不引入 UI framework 或 CSS-in-JS。圖示沿用 `lucide-react`；圖表以手寫的 SVG 元件實作，不引入圖表函式庫。

### 8.3 資訊架構與互動

單頁應用，由上而下依序為：

1. **Top bar**：
   - wordmark。
   - 資料狀態膠囊：顯示快照日期與涵蓋範圍；點開後顯示 `releaseId`、`snapshotId` 與最後同步時間。
   - 保存清單入口與主題切換。
2. **對戰舞台**：左右各一張主體卡，顯示大頭像或隊標、名稱、真名、類型與 era 標籤，卡片內嵌搜尋 combobox；兩張卡中間是交換按鈕。主體選定後立即套用。
3. **篩選列**：
   - 篩選項目：日期快速選項（全部、近 1 年、近 3 年、自訂區間）、賽事類型、聯賽、賽制。
   - 寬度 ≥ 768px 時，篩選列為可換行的單列；寬度 < 768px 時收進 bottom sheet，並顯示啟用中的篩選數量。bottom sheet 開啟時鎖定焦點；以 Escape、點擊背景或按完成關閉後，焦點回到開啟按鈕。
   - **行為變更**：篩選改為立即套用，移除「套用篩選」按鈕與 draft 狀態。瀏覽紀錄的合併規則如下：
     - chip 切換在 500ms debounce 內只產生一次 `pushState`。
     - 日期輸入在 blur 或按 Enter 時提交，產生一筆紀錄。
     - 交換雙方、變更主體各自產生一筆紀錄。
     - canonicalize 使用 `replaceState`。
     - Back／Forward 必須完整還原篩選與主體。
   - 日期區間無效時以 inline 錯誤提示，不套用也不 push。
4. **總覽計分板**：顯示 series W–L（有平手時另外列出 draws）、game W–L、以雙方側色分割的勝率條，以及最近 5 場系列賽的結果（W／L／D 標記並附文字說明）。
5. **統計拆解**：依年份、依賽事類型呈現的 SVG 長條圖，資料來自 `breakdown` API（§8.4）。
6. **賽果清單**：
   - 依年份分組，年份標題為 sticky。每列顯示日期、賽事、BO、雙方當時的隊名、比分與結果徽章（WIN／LOSS／DRAW）。
   - **新增功能**：每列可展開單局明細，顯示每局勝方與雙方隊伍；若比較的是 player，另外顯示該局成員。單局資料有缺漏時要明確標示。
   - 分頁：提供「載入更多」按鈕，並以 IntersectionObserver 自動載入。自動載入可以關閉；`prefers-reduced-motion` 開啟時不自動載入；自動載入失敗時顯示錯誤，並保留手動載入的按鈕。
7. **匯出**：入口放在總覽區。匯出 sheet 以新視覺重做，但維持 1200px 固定寬度，以及既有的分頁與 gate 規則。
8. **保存清單**：桌面版為右側 drawer，手機版為全螢幕 sheet，焦點管理方式與 bottom sheet 相同。每個項目顯示雙方名稱、篩選摘要與保存日期；提供 JSON 匯出與匯入（§8.6）。
9. **狀態畫面**：
   - 載入中顯示 skeleton。
   - 資料錯誤時提供重試。
   - 主體不存在時，引導使用者重新選擇。
   - 沒有結果時，說明目前的篩選條件，並提供「清除篩選」。
10. **Footer**：Leaguepedia 來源與授權聲明、圖片權利聲明、`releaseId` 與 image revision。

斷點：

| 寬度 | 版面 |
| --- | --- |
| ≥ 1200px | 完整的三欄對戰舞台 |
| 768–1199px | 主體卡縮小 |
| < 768px | 主體卡上下堆疊、篩選收進 bottom sheet、賽果列改為兩行 |

最小支援寬度為 320px。

### 8.4 API（`/api/v1`）與 release identity

所有回應都以 `packages/contracts` 的 zod schema 驗證：server 輸出前驗證一次，client 收到後再驗證一次。錯誤格式為 `{ error: { code, message } }`。

- **R-API-01 release 釘選**：
  - client 啟動時呼叫 `GET /api/v1/meta` 取得 `releaseId`。之後所有資料請求都帶上 `release=<releaseId>`，TanStack Query 的 query key 也都包含 `releaseId`。
  - server 提供 current release，以及過去 24 小時內曾作為 current 的 release（以唯讀連線池開啟）。這樣同一個 session 內的 resolve、比較分頁、breakdown、單局明細、媒體與匯出，都會落在同一個 release。
  - 若請求的 release 已超出保留範圍，回傳 `410 release_expired`。client 顯示「資料已更新」並提供重新載入；匯出遇到這個錯誤時整份中止，不混用不同 release 的頁面。
  - cursor 格式錯誤，或不屬於該 release 時，回傳 `400 invalid_cursor`。
- **R-API-02 媒體 URL**：
  - 媒體與 credits 以 `/r/<releaseId>/media/...`、`/r/<releaseId>/presentation/...` 提供，並設為 `immutable`；只要該 release 仍在保留範圍內，URL 就有效。
  - release 成品中的媒體 URL，由 export 依 `basePath` 與 `releaseId` 產生。

| Method／Path | 回應 | 備註 |
| --- | --- | --- |
| `GET /api/v1/meta` | `{ releaseId, snapshotId, schemaVersion, dataset, coverage, lastSuccessfulSyncAt, imageRevision }` | `no-cache` |
| `GET /api/v1/entities?release=&q=&kinds=` | `ResolvedSubject[]`，最多 20 筆 | `q` 長度 1–64；同一 IP 每 10 秒最多 30 次 |
| `GET /api/v1/subjects/resolve?release=&kind=&id=&eraId=` | `ResolvedSubject` | 主體不存在時回傳 `404 unknown_subject`，對應 `UnknownPublicSubjectError` |
| `GET /api/v1/comparison?release=&<route query>&cursor=` | `ComparisonResponse` 分頁 | cursor 綁定 `snapshotId`（沿用現有實作） |
| `GET /api/v1/series/:seriesId/games?release=&<route query>` | `{ seriesId, games: [{ id, playedAt, order, winner: "left"\|"right"\|null, left: { teamName, eraLabel, players?: PlayerRef[] }, right: {…} }], complete: boolean }` | 依 `playedAt`、`id` 排序。left／right 以比較雙方的視角標示。只有至少一方是 player 時才提供 `players`。資料缺漏時回傳 `complete=false`，不推測、不補值 |
| `GET /api/v1/comparison/breakdown?release=&<route query>` | `{ byYear: [{ year, series: Record, games: Record }], byEvent: [{ category, series, games }], recentForm: [{ seriesId, date, result: "W"\|"L"\|"D" }] }` | 以完整的篩選集合計算，不受分頁影響。`Record` 與 `seriesSummary` 同型：wins、losses、draws?、total、winRate，分母包含 draws。`year` 取 series `date` 的 UTC 年份。`recentForm` 依 `playedAt` 由新到舊取 5 筆，以左方主體的視角計算 |
| `GET /healthz` | 行程存活狀態 | 不存取資料 |
| `GET /readyz` | current release 已載入、schema 受支援、basePath 相符 | freshness 只反映在 `meta` 與 worker health |

- **R-API-03**：API 只讀取已發布的 release，不得呼叫 Leaguepedia 或任何上游服務（ADR-0001）。
- **R-API-04 路徑與快取**：
  - `/assets/*` 檔名含 hash，設定 `immutable, max-age=31536000`。
  - `/r/*` 須通過 safe-path 驗證，禁止目錄跳脫與 symlink。
  - 其他 GET 請求以 SPA fallback 回傳 `index.html`，並設定 `no-cache`。
- **R-API-05 安全標頭**：
  - CSP 設為 `default-src 'self'`；`img-src 'self' data: blob:`（匯出功能需要）。
  - 另設 `X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`。
  - 不開放 CORS。
- **R-API-06 熱切換**：
  - web 以 `fs.watch` 搭配輪詢監看 `state/current.json`。
  - 新的 release 載入並通過 schema 與 basePath 檢查後才切換；舊 release 的連線在保留期內持續可用。
  - 切換失敗時保留原本的 current，並由 `/readyz` 回報錯誤。
- **R-API-07 效能**：
  - 以 cutover 時的完整資料量（約 7k 以上的 series）、熱快取、20 個並發連線量測，預設比較、搜尋、單局明細與 breakdown 的 server 端 p95 不超過 150 ms。
  - 首頁初始 JS 不超過 180 KB（gzip）。
  - 以 Playwright 搭配 4G throttling，從冷啟動到顯示預設比較結果不超過 2.5 秒，在 image 驗收時量測。

### 8.5 Web runtime

- **R-WEB-01**：
  - `ComparisonApi` 新增 `meta()`、`seriesGames()`、`breakdown()`。
  - production 使用 `http-runtime`；`mock-runtime` 同步實作這些方法，供測試使用。
  - 移除 `static-runtime`、`snapshot-client` 與 `sql.js-httpvfs`。
- **R-WEB-02**：`lang="zh-Hant"`，UI 字串集中管理。
- **R-WEB-03**：支援 `prefers-reduced-motion`；所有互動元件都可用鍵盤操作，且有可見的焦點樣式。

### 8.6 舊 origin 遷移（D6）

- **R-WEB-10 Pages 遷移頁**：
  - 讀取舊 origin 上的 `riftversus.saved-comparisons`（version 2）。
  - 資料編碼後不超過 32 KB 時，以 base64url 放進 URL fragment `#import-saved=`，連同原本的 path 與 query 一起導向新 origin。`/RiftVersus/` 前綴依 R-DEP-15 正規化。
  - 超過 32 KB 時不自動轉移，改為顯示「下載保存的比較（JSON）」按鈕與前往新站的連結。
  - 不論資料大小，遷移頁都提供 JSON 下載按鈕。
  - 遷移頁至少保留 12 個月。
- **R-WEB-11 新 app 匯入**：
  - 偵測到 `#import-saved`，或使用者手動匯入 JSON 時，先以 `storage.ts` 的規則驗證 schema。
  - 顯示「匯入 N 筆」的確認提示；使用者確認後，依 `id` 去重並合併，重複匯入的結果不變（idempotent）；完成後清除 fragment。
  - 驗證失敗或使用者拒絕時，不寫入任何資料並顯示提示，且不影響主流程。

## 9. 測試與驗收

### 9.1 測試調整

- **SQLite 版 integration suite**：依賴 PG 的 integration suite，改寫一份以 SQLite 執行的版本，每個測試使用獨立的暫存 DB 檔。P5 之前，PG 版本仍保留在 CI 中，作為舊發布路徑的回歸測試（D1）。
- **差異 oracle**：P1 時以 PG 路徑對 synthetic 與代表性 fixture 產生 golden 輸出（snapshot projection、comparison 回應、acceptance 結果），並提交為凍結的 fixture。SQLite 路徑必須持續產生相同的輸出；P5 移除 PG 之後，這個 oracle 仍然可以重跑。
- **legacy parity 測試**：在 CI 的 legacy job 中執行，P5 移除。
- **E2E**：以 Playwright 對 `docker run` 啟動的 production image 執行，使用 synthetic fixture release，涵蓋：
  - 預設比較、分享連結、player 身分搜尋、PNG 與 ZIP 匯出。
  - 320／767／768／1199／1200px 各斷點兩側的主要流程。
  - 兩種主題下的 axe-core AA 檢查。
  - bottom sheet 與 drawer 的開關，以及焦點歸還。
  - Back／Forward 還原篩選。
  - 錯誤重試，以及 reduced-motion 下手動載入更多。
  - 單局明細，包含跨頁、BO2 平手與選手換隊的 fixture。
  - breakdown 的數字與 `seriesSummary` 一致。
  - release 切換：在 resolve 與分頁之間切換一次、在匯出途中切換一次，並正確處理 `410`。
  - `PUBLIC_BASE_PATH` 為 `/` 與 `/RiftVersus/` 兩種設定。
  - 保存比較的匯入：真實的舊網址、version 2 資料、超過 32 KB、使用者拒絕、重複匯入。
- **移除 HTTPVFS 專屬測試**：包括 Range、gzip HEAD、Worker 損壞後重試，以及 `scripts/static-network-profile*`。
- **新增 server 與 worker 測試**：
  - server：safe-path、安全標頭、rate limit、308 導向與防止迴圈；熱切換時進行中的請求不中斷。
  - 鎖與排程：手動 run 遇到鎖被占用時回傳 `locked`、排程 pending 合併、補跑規則。
  - run 生命週期：逾時；硬終止後重啟時的對帳；abandoned candidate 不得被 promote；多批 history 部分失敗。
  - 資料保護：media-only 的差異防護；attempt 不得被拿來還原。
  - 部署：在空白 volume 上以非 root 執行 `init`。
- **舊發布路徑回歸**：P1–P4 的每個 PR 都必須讓現有的 `pnpm test`、PG integration 與 static E2E 照常通過；`publish.yml` 所依賴的指令行為不得改變。

### 9.2 Shadow run（P3，在目標主機上）

- 使用獨立的 shadow volume（R-DATA-44），排程的 current run 須連續成功至少 7 次。
- 每次 shadow run 都要與同一天 Actions 產生的 checkpoint 比對資料：同一批 scope 的 series 與 game 數須一致；若有差異，必須能以上游資料的時間差解釋，並記錄下來。
- history：在明定的 scope 範圍內，worker 對每個 scope 的成功或失敗結果，必須與同一週 Actions history run 的結果一致。
  - fail closed 的 scope（例如已知的上游缺漏）必須產生可重讀的 attempt，且失敗原因與 Actions 相同。
  - 若 cutover 必要的 scope 被真實的上游問題阻擋，標記為 cutover 阻塞，不得放寬 gate 來繞過。
- `release rebuild --verify` 結果一致，備份與還原演練（R-DATA-53）通過。

### 9.3 Cutover 驗收（以下全部成立後，才執行 R-DATA-45 的步驟 5 與 6）

1. §9.2 全部通過。
2. 依序完成 R-DATA-45 的步驟 1 到 4，且 R-DATA-42 與 R-DATA-43 通過。
3. 對正式 origin 執行 release 版 E2E（desktop 與 mobile），包括 PNG／ZIP 的可見像素檢查與冷啟動預算。
4. web 與 worker 的 image ID 相同、以非 root 執行、rootfs 為唯讀，資源用量符合 R-DEP-07，並通過相容矩陣演練（R-DEP-42）。
5. 舊分享連結（legacy UUID、readable、`/RiftVersus/` 前綴）在新 origin 上都解析到正確的主體。
6. R-OPS-07 對外驗證通過。
7. cutover 完成後，另開 PR 刪除 `publish.yml`，並依 §10 讓其餘項目退場。

## 10. 退場清單（P5）

| 項目 | 處置 |
| --- | --- |
| `.github/workflows/publish.yml` | 刪除；repo variable `PUBLISH_ENABLED` 維持 `false` |
| `ci.yml` 中的 PostgreSQL service、PG client、checkpoint DB 與 legacy job | 刪除；保留 docker build 與容器 E2E |
| `apps/data` 的 `publish-run`、`publish-github`、`publish-plan`、`site-bundle`、`site-commands`、`archive-commands`、`release-store`、`checkpoint-release`、`checkpoint`（PG）、`postgres-checkpoint`、Release 版 `attempt-archive`、`media-archive`（Release 傳輸） | 刪除；attempt 與 media 已改用本機版本 |
| `acceptance:archival`（`apps/data/src/acceptance-cli.ts`，目前使用 PG comparison repository） | P1 改用 SQLite canonical 的 comparison 查詢，以指定的 generation 執行，並以凍結的 acceptance fixture 保留可重跑的歷史基準 |
| PG 差異測試（例如 `packages/database/test/snapshot.integration.test.ts`） | 由 §9.1 的凍結 golden fixture 取代後刪除 |
| `packages/database` 的 PG 實作、`pg`、`@types/pg` 與 PG migrations | 刪除；migrations 移到 `docs/archive/postgres-migrations/` 保存為歷史紀錄 |
| `Dockerfile` 的 `legacy-tools` target 與 compose 的 `legacy-import` profile | 刪除 |
| `apps/web` 的 `static-runtime`、`snapshot-client`、`sql.js-httpvfs` | 刪除；release E2E 的 `RIFTVERSUS_E2E_BASE_URL` 改指向新 origin |
| `scripts/measure-static-sqlite.mjs`、`verify-hosted-workflows.mjs`、`static-network-profile*` | 刪除；`build-static-fixture.mjs` 若仍用於產生 E2E fixture，改寫後保留 |
| `test/github-publish.test.ts`、`test/github-ci.test.ts` | 改寫為驗證新的 `ci.yml`、Dockerfile 與 compose 約束 |
| compose 的 `postgres` 與 `minio` profile | 刪除；named volume 不刪 |
| `docs/github-publishing.md`、`github-pages-actions-proposal.md`、`checkpoints.md`、`site-archives.md` | 移到 `docs/archive/` 並標註為歷史紀錄；改寫 `README.md`、`deployment.md`、`operations.md`、`sqlite-development.md` |
| 私有 `RiftVersus-data` 的 checkpoint、media 與 site Releases，以及舊 volume 與備份 | 保留，不刪除 |
| ADR 與 baseline | P1 建立 ADR-0002；P5 完成後建立新的 baseline |

## 11. 分階段計畫

每個 phase 是一個獨立的 PR，前一個 phase 通過後才進行下一個。P5 之前，生產環境仍由 `publish.yml` 與 Pages 提供服務，且每個 phase 都不得破壞舊的發布路徑（§9.1）。

| Phase | 內容 | 生產影響 |
| --- | --- | --- |
| P0 | 本規格（純文件） | 無 |
| P1 | 建立 SQLite canonical，與 PG 並存：<br>• 選定驅動、baseline migration<br>• §7.3 寫入保證、SQLite repositories<br>• gate 與拒絕測試、凍結的 golden oracle<br>• archival acceptance 移植<br>• legacy 工具 image 與 parity 驗證<br>• ADR-0002 | 無 |
| P2 | • `apps/server`、API、release 模型<br>• `http-runtime`（暫時沿用舊 UI）<br>• production Dockerfile、compose、runtime base path<br>• CI 加入 docker build 與容器 E2E | 無 |
| P3 | • worker 排程、鎖、對帳<br>• attempt、告警、備份、`media import`<br>• 在目標主機以 shadow volume 執行 §9.2 | 無（與 Pages 並行） |
| P4 | • 前端重設計<br>• 單局明細與 breakdown UI<br>• 保存比較的匯入與匯出<br>（可與 P3 並行） | 無 |
| P5 | • 依 R-DATA-45 與 §9.3 執行 cutover<br>• Pages 遷移頁<br>• 依 §10 退場<br>• 更新文件並建立新 baseline | 生產環境切換 |

## 12. 風險與緩解

| 風險 | 緩解 |
| --- | --- |
| 單一主機故障或磁碟損毀 | 可獨立還原的備份集，加上以 restic 做異地保存（D4、R-DATA-51）；以乾淨主機做還原演練（R-DATA-53） |
| 長期增量寫入造成資料漂移 | candidate 隔離（R-ARCH-01）、每週重建驗證（R-OPS-05）、`integrity_check` |
| 未通過驗收的寫入污染 canonical | 只寫入 candidate，並以唯一的 commit 點切換（R-ARCH-03） |
| `node:sqlite` 仍標示為 experimental | 鎖定 Node 小版本；P1 依證據決定驅動；以 adapter 隔離 |
| SQLite 的 trigger 授權語意弱於 PG | 依 §7.3 做等價設計，並移植全部的拒絕測試 |
| 非 ASCII 搜尋的行為改變 | 新增 fold 欄位，並加入多語言測試 |
| 遷移期間資料分歧或遺失 | 遵守 cutover 交接順序（R-DATA-45）、物件對帳、嚴格的 parity 驗證 |
| 換 origin 後保存比較與分享連結失效 | 遷移頁、fragment 轉移、JSON 下載與匯入、308 導向 |
| 生產環境不再每次發布都截圖 | 瀏覽器驗證改為隨 image 版本執行；promote 後做對外驗證（R-OPS-07） |
| 常駐排程無聲失效 | worker healthcheck、webhook 告警，並由 `meta` 公開最後同步時間 |
| release 切換造成同一畫面的資料不一致 | 以 release 釘選搭配 24 小時保留（R-API-01） |

## 13. Governance 7 維度審查

| 維度 | 評估 |
| --- | --- |
| Ownership integrity | 每一項都只有一個 owner：<br>• facts：Leaguepedia<br>• canonical 寫入：worker（唯一 writer lock 與唯一 commit 點）<br>• 查詢語意：`@riftversus/domain`<br>• 公開讀取：web（只讀不可變的 release）<br>• 排程：worker<br>• 備份：`backup` 指令<br>• 媒體資格：sync 與 `media import` 的 gate |
| Module boundaries | web 只依賴 contracts、domain 的型別與 API；server 依賴 domain 查詢，不 import `packages/sync`；只有 worker 使用 sync 與 database。 |
| Contract changes | • 新增：`/api/v1`、release identity、`410` 與 `400` 錯誤碼、單局明細與 breakdown 的 contract、保存比較匯入<br>• 行為變更：篩選立即套用、base path 預設為 `/`、rollback 拆成三條路徑<br>• 不變：URL 參數與 schema v3<br>全部由 ADR-0002 記錄。 |
| Cascade proliferation | 移除 PG、Release 封存協定、Pages、HTTPVFS 四條外部依賴鏈。新增的依賴只有 HTTP 框架與排程函式庫，在 P2 與 P3 選定並說明理由。 |
| Dependency direction | apps 依賴 packages，contracts 最穩定；domain 不依賴 database；不新增反向依賴。 |
| Retirement completeness | §10 逐項列出退場項目，並綁定在 P5。PG 只以 legacy 工具 image 暫時保留，且有明確的刪除時點；差異 oracle 與 archival acceptance 都已有替代方案。 |
| Entropy flow | 整體複雜度淨減少：只剩一種資料庫引擎、一個查詢執行位置，也不再需要 Release 封存協定與 Range 傳輸驗證。新增的 server、worker 排程與 release 模型，是 Actions 退場後必要的替代。 |

## 14. 待 plan 階段定案（不影響本規格核准）

- HTTP 框架：Fastify 5 或 Hono。
- 排程：使用 croner，或自行實作 UTC cron 解析。
- 資料庫驅動：Kysely 搭配 `node:sqlite` 或 `better-sqlite3`（R-DATA-03）。
- 是否需要 FTS5 trigram 索引。
- schema 是否升級到 v4，以提升 breakdown 與單局明細的查詢效能；若升級，必須遵守 R-DEP-42。
- runtime base path 的實作方式（R-DEP-14）。
