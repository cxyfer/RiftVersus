# RiftVersus 重構規格：Docker image 部署、SQLite 資料維護與前端 UI 重設計

- Date: 2026-11-22
- Status: Proposed。本文件待使用者審核，不改變任何生產狀態。
- Scope: `both`（requirements + architecture）
- Supersedes：核准且 P5 完成後，取代 [2026-10-03 GitHub / SQLite baseline](../baseline/2026-10-03-riftversus-github-sqlite.md) 中以下 owner：部署、排程、持久化、checkpoint、媒體傳輸、網站 rollback，以及瀏覽器查詢傳輸。
- Preserves：
  - [ADR-0001](../adr/ADR-0001-leaguepedia-facts-and-fail-closed-presentation.md) 的 facts 與媒體權利決策，含 2026-10-04 reviewed editorial images amendment。
  - [Comparison Identity and Canonical Avatar v2](2026-07-18-comparison-identity-avatar-v2-design.md)。
  - [Public IDs and real media](2026-10-03-public-identity-real-media.md)。
  - [SQLite query performance](2026-10-04-sqlite-query-performance.md) 的查詢語意。

## 1. 背景與動機

現行部署方式（依 2026-10-03 baseline 與之後的 ADR-0001 amendment）：

- **發布流程**：GitHub Actions `publish.yml` 是唯一的排程寫入者。每次執行都在全新 runner 上，從私有 `cxyfer/RiftVersus-data` Release 還原 PostgreSQL 17 dump 與物件，再依 mode 執行以下步驟：
  - `current`、`history`、`backfill`、`media`：sync，接著匯出候選 SQLite、acceptance、封存新的 checkpoint 與網站、瀏覽器驗證，最後部署 GitHub Pages。checkpoint 可能在網站 smoke 之前就完成提交。
  - `reexport`：以 migration 後的資料重新匯出，並封存新的 checkpoint。
  - `rebuild`：從最新的 checkpoint 重新匯出並部署網站，不封存新的 checkpoint。
  - `rollback`：重新部署已封存的 immutable site，不匯出，也不推進 data lineage。
- **儲存**：PostgreSQL 只是暫時性的 ingestion／restore 工具，持久保存靠 `pg_dump` checkpoint。審閱過的媒體位元組另外存放在私有的 immutable media Release。
- **查詢**：瀏覽器透過 `sql.js-httpvfs` Worker/WASM，以 Range request 查詢 Pages 上的 SQLite。

使用者要求三項變更：

1. 重新設計前端 UI。
2. 部署改為 Docker image，移除現行的 GitHub Actions 發布方式。
3. 以 SQLite 維護資料，讓 SQLite 成為唯一的資料庫引擎，PostgreSQL 退場。

現行架構的成本：

- 每次 sync 都要還原完整 PG dump、安裝 PG client 並執行 Playwright。
- 資料、媒體、網站封存都綁在 GitHub Release／Pages 上。
- ingestion 與 serving 用兩種資料庫引擎，只能靠 parity 測試維持一致。
- HTTPVFS 需要 Range、gzip HEAD、Worker 等專屬驗證。

## 2. 目標與非目標

### 2.1 目標

- **G1**：只有一個 production Docker image。`web` 與 `worker` 兩個服務使用同一個 image ID，所有日常維運指令也都在這個 image 內。
- **G2**：SQLite 是唯一的資料庫。canonical 資料與公開查詢快照都存在 SQLite；canonical 資料包括 facts、provenance、授權稽核、sync runs、publication generation、public ID 與媒體 metadata。PostgreSQL 只出現在一次性遷移用的 legacy 工具 image（§7.6），P5 後移除。
- **G3**：移除 `publish.yml` 與 GitHub Pages 部署。Actions 原本提供的排程、單一 writer、等待中的 run、逾時、失敗封存、通知、secrets 注入與部署後驗證，各自要有明確的新 owner（§6.4）。
- **G4**：前端重新設計，提供對戰總覽、分組賽果、單局明細與統計拆解，支援亮／暗主題與手機版，並保留所有既有的使用者契約（§8.1）。
- **G5**：沿用 ADR-0001 的資料與媒體治理：
  - Leaguepedia 是唯一的自動 facts provider。
  - 只發布有授權（license）的媒體，或有結構化 editorial rights basis 的審閱媒體；其他媒體一律 fail closed。
  - 生成頭像只是呈現輸出，不構成 provenance。
- **G6**：遷移不得遺失或改變已驗證的資料與物件。cutover 時從最後一份 verified checkpoint 重新遷移；若有尚未進入 checkpoint 的已驗證本機資料（例如 baseline 記錄的本機 domestic／EWC 覆蓋），改以通過驗收的本機同源後繼作為遷移輸入（R-DATA-46）。兩者都要通過嚴格的 parity 檢查（§7.6、§9.3）。已與正式 lineage 分岔的本機資料是明文例外（D11）：完整封存、永久保留，但不保證原樣進入新的 canonical。

### 2.2 非目標

- 新增或替換資料來源；放寬 mapping、redirect、格式、覆蓋率或媒體權利的 gate。
- 使用者帳號、伺服器端保存比較，或其他公開寫入功能。
- 多主機高可用、Kubernetes、跨主機共用 SQLite 檔案。
- 用 Actions 或任何 CI 擔任生產環境的寫入者或部署者。
- 實體刪除既有的私有 Release、Docker volume 或備份。

## 3. 決策點（PR 審核時請逐項確認）

PR 核准即視為接受下表的建議預設；若要改用替代方案，請在審核時註明。

| # | 議題 | 建議預設 | 替代方案 | 理由 |
| --- | --- | --- | --- | --- |
| D1 | `ci.yml` 去留 | 保留為 PR／main 的純驗證。P5 前保留 PG service，作為舊發布路徑的回歸測試；另外新增 `docker build`、容器 E2E 與 legacy 工具 image build。CI 不持有生產 secret，不 push image，也不部署。P5 時移除 PG。 | 完全移除 Actions，只在本機驗證 | 「移除 Actions 部署方式」指的是 `publish.yml`。PR 驗證不屬於部署，而且是目前唯一的自動回歸保護。 |
| D2 | image 由誰 build | 部署主機以已審核的 git commit／tag 執行 `docker compose build worker`。`worker` 服務是唯一的 build owner，image tag 為 `riftversus:<git-sha>`，`web` 直接使用這個 tag（R-DEP-11）。 | 維運者手動 `docker buildx build --push` 到 GHCR，主機再 `pull` | 部署不依賴任何 CI，也不需要 registry 憑證。 |
| D3 | 排程 owner | 由 `worker` 容器內建排程，設定 `restart: unless-stopped`。預設 UTC `17 19 * * *` 跑 current，`47 20 * * 6` 跑 history。 | 設定 `WORKER_SCHEDULE=off`，改由主機 cron／systemd timer 每 5 分鐘執行 `docker compose run --rm worker schedule tick`（R-DEP-22） | baseline 讓 resident scheduler 退場，是因為當時排程由 Actions 負責。Actions 移除後，排程放進 image 才符合「只靠 Docker image 部署」。兩種方式走同一條 `schedule tick` 程式路徑。 |
| D4 | 備份與異地保存 | 主備份是 volume 上可獨立還原的備份集（§7.7），保留 14 份，每次 commit 後更新。異地保存由維運者用 restic／rclone 同步整個 `backups/`，app 不內建，文件提供範例。私有 GitHub Release writer 在 P5 退場。 | 保留 `release-store` 作為可選的異地 adapter，代價是要長期保存 `RIFTVERSUS_DATA_TOKEN` | 降低對 GitHub 的耦合與系統 entropy。既有 Releases 保留為歷史證據與遷移來源，不刪除。 |
| D5 | 前端資料傳輸 | 改用 server JSON API。server 以 `node:sqlite` 唯讀開啟已發布的 release，並重用 `@riftversus/domain` 的查詢。移除 `sql.js-httpvfs`、Worker/WASM 與 Range 傳輸。 | 保留 HTTPVFS，容器只提供靜態檔與 Range | 有 server 後，查詢放在 server 端更簡單、更快，也更容易觀測；查詢語意仍只由 domain 擁有。 |
| D6 | GitHub Pages、舊 origin 與 base path | Pages 的發布來源改為「Deploy from a branch」的 `gh-pages` 分支，不需要任何 repo workflow。最後發布的是遷移頁，提供 path／query 轉址、保存比較的轉移與 JSON 下載（§8.6），至少保留 12 個月。緊急復原（R-DEP-43）也走同一個分支。base path 改為 runtime 設定 `PUBLIC_BASE_PATH`，預設 `/`，同一個 image 要能支援任意前綴（§6.2）。 | 直接停用 Pages，接受分享連結與 localStorage 失效 | 保護既有的分享連結與使用者的保存資料；刪除 `publish.yml` 後 Pages 仍有發布入口。 |
| D7 | 部署主機 | 不綁定特定主機，只假設：單一 Linux 主機、Docker Engine 加 Compose v2、本機磁碟。TLS 與網域由維運者的 reverse proxy 負責，容器只開放 HTTP `:8080`。 | 指定某個雲端供應商 | 主機尚未決定。 |
| D8 | 每次發布的驗證 | production image 不含 Chromium。promote 前，對候選 release 執行 in-process HTTP smoke；commit 後，透過正式 origin 做 HTTP 驗證（R-OPS-07）。瀏覽器 E2E 在 CI 對 image 執行，並在 cutover 與每次 image 升級時，對正式 origin 執行 release 版 E2E。 | production image 內含 Chromium，每次發布都截圖 | Chromium 會讓 image 增加數百 MB。資料發布不會改動前端程式碼，瀏覽器行為只隨 image 版本改變。 |
| D9 | 審閱媒體位元組的來源 | 用 `riftversus run media --pack <zip>` 匯入受審的 ZIP 並在同一個 run 內發布。受信任的 checksum 只來自 repo 內已審閱的 `data/overrides/media.json`：整包為 `archive.checksum`／`archive.byteSize`，逐檔為 `assets[].rightsBasis.fileChecksum`／`assets[].byteSize`（R-DATA-31）。審閱包由維運者自行下載，例如用 `gh release download`。 | worker 直接讀取私有 media Release（需要 token） | 執行期不需要 GitHub token，審閱與校驗的 gate 維持不變；匯入與發布在同一個 run，物件不會在兩步之間失去引用。 |
| D10 | 等待中的 run | 每種 run kind 各保留一筆 pending（R-DEP-21）。這是刻意的行為變更：現行 Actions 的 concurrency group 讓所有 mode 共用一筆等待中的 run。 | 所有 kind 共用一筆 pending，與現行相同 | 每日 current 不應把每週 history 擠掉。 |
| D11 | 已分岔的本機資料 | 已驗證的本機資料若是正式 checkpoint 的同源後繼，原樣作為遷移輸入；若已與正式 lineage 分岔，則不自動整併。遷移輸入固定為正式 checkpoint，分岔資料完整封存、永久保留，cutover 後以新的 run 重新取得（R-DATA-46）。這是 G6 的明文例外，須經使用者核准。 | 開發雙 lineage 的受控整併工具，逐列裁決後合併 | 同一個 `generation` 的兩個版本無法在 append-only 的 publication 模型中同時成立；整併工具的成本與風險遠高於重新取得。 |

## 4. Baseline 與 ADR 對照

| 現行 owner／條目（2026-10-03 baseline、ADR-0001） | 處置 | 新 owner |
| --- | --- | --- |
| Leaguepedia 擁有 source facts；reviewed mapping、redirect、correction 皆 fail closed | 保留 | 不變 |
| `data/leaguepedia/competition-map.json` 擁有 competition/year source key | 保留 | worker 從同一個檔案產生正式排程計畫（R-OPS-10） |
| 私有 immutable checkpoint Release 擁有持久化資料（ADR-0001 Compatibility Boundary） | 取代 | volume 上的 canonical lineage 與備份集（§5.2、§7.7）。既有 Releases 改作為遷移來源與歷史證據 |
| 失敗的 attempt 是獨立的 forensic 封存，不能當作還原基礎 | 保留語意 | `/data/attempts/`（R-OPS-03） |
| `apps/data` 擁有一次性的 import／acceptance／export；PG 只是暫時性工具 | 取代 | `apps/data` 的指令保留，儲存改為 SQLite；PG 只在 legacy 工具 image 中使用 |
| ADR-0001 Retirement Impact：「Retain PostgreSQL migrations, archival acceptance and differential test oracle」 | 取代 | migrations 在 P5 後封存。archival acceptance 移植到 SQLite，並以固定的歷史 checkpoint 驗收。差異 oracle 改為凍結的 golden fixture（§10） |
| 正規化並加上索引的 SQLite 擁有公開查詢（schema 3） | 保留 | 查詢改在 server 執行 |
| ADR-0001：「Browser queries execute … sql.js-httpvfs … No HTTP API … survives」 | 取代（D5） | `apps/server` 的 `/api/v1` |
| ADR-0001 Retirement Impact：「Delete Fastify/server workspace, application Docker carriers, resident cron scheduler」 | 依本次需求變更，刻意重新引入 | 新的 `apps/server`、Dockerfile 與 worker 排程。不恢復 PostgreSQL、S3、MinIO 依賴 |
| `publish.yml` 是單一的排程 publisher | 取代（D3） | worker 加上 writer lock（§6.3） |
| GitHub Pages 提供公開網站 | 取代（D6） | `web` 容器 |
| 審閱過的圖片存放在私有 immutable media Release，publication 時校驗 | 取代傳輸方式，保留 gate（D9） | `run media --pack` 與本機 object store |
| 網站 rollback 會部署含 UI 的完整 immutable site；schema 2 site 仍可讀取 | 拆成三條回復路徑（§6.7） | serving rollback、image rollback、舊 site 封存的緊急復原 |
| 可讀的 entity／era URL key 有持久化的 scoped ownership，後到者不能搶走已發布的 ID | 保留 | SQLite canonical 加 trigger（§7.3）；rollback 與還原都不得讓這個保證倒退（§6.7） |
| 分享、保存比較、匯出都是 client 功能 | 保留 | 不變；資料改由 API 提供 |

核准後，P1 要建立 **ADR-0002（Docker／SQLite 自主部署）**：逐條取代上表標為「取代」或「重新引入」的 ADR-0001 條款，並寫明新的相容契約、終止條件與退場時點。ADR-0001 關於 facts provider、媒體權利與生成頭像的決策不變。P5 完成後，另建新的 baseline 記錄實測狀態。

## 5. 目標架構

### 5.1 元件與 volume 配置

```text
┌──────────────────────────── Docker host（單一主機、本機磁碟） ────────────────────────────┐
│ worker（riftversus:<sha> `worker`）                                                     │
│   schedule tick → writer lock → candidate（複製 head）→ sync → export → acceptance       │
│   → smoke → 耐久落盤 → state.json 原子切換（commit）→ 備份 → 對外驗證                   │
│                                                                                         │
│ volume /data                                                                            │
│   db/lineage/<lseq>.sqlite（已提交、不可變）   db/candidates/<runId>/                   │
│   releases/<releaseId>/{release.json, data/…, presentation/…}（不可變）                 │
│   media/<sha256>.<ext>（內容定址的公開媒體池）                                         │
│   objects/<object-key>/{body,metadata.json}（FilesystemObjectStore）                    │
│   state/state.json（唯一 commit 點）  state/commit-log.jsonl  state/lseq                │
│   schedule/scheduler.sqlite   attempts/<runId>/   backups/   locks/                     │
│                                                                                         │
│ web（riftversus:<sha> `serve`；整個 /data 唯讀掛載）                                    │
│   GET / (SPA)  /api/v1/*  /presentation/<sha>.<ext>  /presentation/image-credits.html   │
└───────────────────────────────────▲─────────────────────────────────────────────────────┘
                                    │ reverse proxy（TLS）← 使用者
```

### 5.2 Lineage、serving 與唯一 commit 點

- **R-ARCH-01：canonical lineage（寫入歷史）**
  - 每次提交產生一個不可變的 lineage 檔 `db/lineage/<lseq>.sqlite`。`lseq` 來自 `state/lseq` 的單調遞增計數器，永不倒退，rollback 與 restore 也不例外。檔名中的 `lseq` 與 DB 內部的 `dataset_versions.generation` 是兩回事。
  - `state.json` 的 `head` 指向最新一個已提交的 lineage 檔。每次寫入 run 都先用 SQLite backup API 把 `head` 複製成 `db/candidates/<runId>/candidate.sqlite`，所有寫入只發生在 candidate 上。
- **R-ARCH-02：release 成品與識別**
  - `releases/<releaseId>/` 的內部結構沿用現有 exporter 的輸出（`data/manifest.json`、`data/*.sqlite`、`presentation/…`），另外新增一個 `release.json`。沿用目錄結構只讓 `current-snapshot-acceptance` 的成品讀取（`verifyPublicSnapshot`）可以直接使用；它的 canonical 查詢目前走 PG，P1 必須移植（R-DATA-42）。
  - 快照內的媒體 URL 沿用現行的穩定格式 `${basePath}presentation/<sha256>.<ext>`，不含 `releaseId`，所以沒有雜湊循環，`snapshotId` 也能和舊 Pages 做 parity。
  - 計算順序：先算 `snapshotId`（沿用 `snapshotDigest`），接著產生 SQLite 檔並計算 checksum，最後算 `releaseId`。
  - `releaseId` 是 `release.json` 中「識別欄位」正規化後的 sha256。識別欄位只包括：`snapshotId`、`schemaVersion`、`basePath`、各成品檔的 sha256 與 bytes，以及媒體 checksum 清單。
  - `release.json` 只存放由內容決定的欄位：上述識別欄位，加上從快照推導出的 `datasetVersion` 與 `coverage`。`lseq`、`runId`、`imageRevision`、`createdAt` 這類逐次執行的 metadata 不寫進 release 目錄，而是記在 commit log（R-ARCH-03）。
  - 匯出必須是決定性的：相同的 lineage 內容與 `basePath`，在相同的 exporter 版本下，一定得到相同的 `snapshotId` 與 `releaseId`。因此不同的 lineage 可能產生同一個 `releaseId`。
  - 安裝紀錄：release staging 在改名前寫入 `install.json`：`{ installId, exporter: { imageRevision, imageDigest? }, installedAt }`。`installId` 每次安裝都重新產生；它不屬於識別欄位，不參與 `releaseId`，`release.json` 仍只含由內容決定的欄位。目錄被 prune 刪除後再次安裝，會得到新的 `installId`。
  - 目的目錄 `releases/<releaseId>/` 已經存在時，先依 R-ARCH-03 判斷它是否具有重用資格，再逐檔驗證 checksum：具資格且全部相符，就丟棄 staging、重用既有目錄，exporter 身分取自該目錄的安裝紀錄；不具資格就依 orphan 處理；任何 checksum 不符就 fail closed 並告警，不覆寫。
  - 媒體檔以內容定址，在 promote 時從 release 複製到共用的 `media/` 池；只要還有任何一個保留中的 release 引用，就不會被刪除。
- **R-ARCH-03：state 與唯一 commit 點**
  - `state/state.json` 的內容為：

    ```text
    { commitSeq,
      head: { lseq, runId, schemaVersion, producer: { imageRevision, imageDigest? } },
      serving: { releaseId, installId, lseq, schemaVersion },
      previousServing: { releaseId, lseq } | null,
      lastCommit: { commitSeq, kind, runId, imageRevision, imageDigest?, at },
      servingExporter: { imageRevision, imageDigest? },
      updatedAt }
    ```

    - `head` 是寫入歷史，`serving` 是目前對外提供的 release；兩者分開記錄（§6.7）。
    - `head.producer` 是產生這個 lineage 的 image，只有推進 head 的提交才會更新；`schemaVersion` 是各自 lineage 的 canonical schema 版本。這些欄位是 lineage 來源身分的持久 owner，備份從這裡取得。
    - `commitSeq` 單調遞增。每一次改變 `head` 或 `serving` 的操作（`run`、`migrate`、`release promote|rollback|rebuild --promote`、`backup restore`）都是一次提交，都有自己的 `runId`。
  - **commit log**：`state/commit-log.jsonl` 是 append-only 的切換事件流，每次提交一行：`{ commitSeq, kind, runId, head, serving, imageRevision, imageDigest?, servingExporter, at, sha256 }`，`sha256` 是該行其餘欄位正規化後的雜湊。
    - `imageRevision` 是執行這次提交的 image；`servingExporter` 是實際匯出目前 serving release 的 image，兩者分開記錄。只有新匯出 release 的提交才設定新的 `servingExporter`；重用既有 release、rollback 與 restore 都沿用實際採用的 release 目錄的安裝紀錄（restore 依 R-DATA-52 第 2 步決定採用哪一份成品）。
    - `imageRevision` 是必填的 git revision（D2）。`imageDigest` 是選填，由主機以 `RIFTVERSUS_IMAGE_DIGEST` 注入（R-DEP-12）；容器無法自行取得自身 digest。
    - 合法的 log 必須是完整、可解析、且 `commitSeq` 從 1 起連續的序列；最後一行若不完整或雜湊不符，視為未寫完的尾段（見 R-ARCH-04）。
    - 它是 `releaseId` 與 lineage 對應關係的唯一 owner；同一個 `releaseId` 可以在不同事件中對應不同的 `lseq`，以最新的事件為準。
    - release 的保留期由事件序列推導：某個 release 目前正在 serving，或在過去 24 小時內有事件把 serving 從它切走，就算在保留期內。rollback 重新啟用舊 release 時只是新增一筆事件，不回改舊紀錄。
    - GC、`release rebuild` 與 `release rollback` 都從 commit log 取得 release 對應的 lineage。
    - 重用條件：重用資格綁定目錄的實際安裝，而不是 `releaseId` 本身。事件的 `serving.installId` 記錄它引用的那一次安裝；只有 `releases/<releaseId>/install.json` 的 `installId` 已被某筆事件引用，該目錄才具有耐久的 exporter 紀錄，可以依 R-ARCH-02 重用。重用時 exporter 身分取自安裝紀錄，且必須與引用事件的 `servingExporter` 相同，不同就 fail closed。只有舊事件引用同一個 `releaseId` 不構成資格，例如目錄曾被 prune、之後另一次匯出以同一個 `releaseId` 重新安裝。若目錄存在、但它的 `installId` 沒有被任何事件引用（例如 release 目錄已落盤、`state.json` 尚未提交時中斷），就是 orphan：把它改名為 `releases/.orphan-<releaseId>-<ts>/` 保留作為證據，再改名本次的 staging，exporter 身分採本次的 image。
  - **`lseq` 配置**：配置新的 `lseq` 時，先以 tmp 檔 + fsync + rename + 目錄 fsync 更新 `state/lseq`，之後才把 candidate 改名為 lineage 檔。對帳時 `state/lseq` 取 `max(state/lseq, head.lseq, db/lineage/ 中的最大序號)`，序號永不重用。
  - 提交依下列順序進行：
    1. 耐久落盤，對每個檔案和每個目的目錄都執行 fsync：
       - candidate 相對於 head 新增引用的所有物件（`objects/` 的 `body`、`metadata.json` 與其目錄），不論是本次寫入，還是 `putImmutable` 走既有分支重用的物件（例如前一個被終止的 run 留下、尚未確認耐久的 orphan）。一律在提交前重新 fsync，再驗證 checksum。現行 `putImmutable` 只做 rename，P3 必須補上 fsync。
       - candidate 改名為 `db/lineage/<lseq>.sqlite`。
       - release staging 改名為 `releases/<releaseId>/`，目錄已存在時依 R-ARCH-02 重用。
       - 新媒體寫入 `media/`。
    2. 寫入 `state.json.tmp` 並 fsync，再 rename 成 `state.json`。這次 rename 是唯一的 commit 點。
    3. fsync `state/` 目錄。
    4. 在 commit log 追加本次事件並 fsync。
- **R-ARCH-04：提交狀態與對帳**
  - 每次提交的狀態分為三種：
    - **未提交**：rename 之前就失敗。candidate 與 staging 一律丟棄，`state.json` 保持不變。
    - **已提交**：rename 成功，目錄 fsync 也成功。
    - **提交不確定**：rename 已經呼叫，但目錄 fsync 失敗，或行程在這之間被終止。此時行程以非零碼結束，run 標記為 `commit_uncertain`。
  - 對帳時機：每個寫入指令取得 writer lock 之後、執行任何寫入或 GC 之前，都要先對帳。常駐 worker 接手下一次寫入、或手動指令被終止後再由 worker 接手，都適用。對帳是冪等的，步驟如下：
    1. 修復 commit log：若最後一行不完整或雜湊不符，把 log 截斷到最後一個合法行並 fsync（被截掉的尾段另存到 `state/commit-log.torn-<ts>` 作為證據）。
    2. 讀取實際的 `state.json`，並先 fsync `state.json` 與 `state/` 目錄，讓可能處於 `commit_uncertain` 的 rename 成為耐久狀態。之後才處理 log：若它的 `commitSeq` 等於 log 最後一筆加 1（空 log 視為 0），就依 `lastCommit`、`head`、`serving` 與 `servingExporter` 補寫缺少的那筆事件並 fsync；若差距大於 1，或 log 的最後一筆大於 `state.json` 的 `commitSeq`，代表狀態損毀，fail closed 並告警，不自動修復。
    3. 若 `lastCommit.runId` 等於某個 `running`／`commit_uncertain` 的 run，把該 run 判定為 `succeeded`，並補做尚未完成的提交後步驟：備份與對外驗證。這同時涵蓋只切換 `serving` 的提交。`kind: restore` 的提交例外：對帳只補齊 commit log、備份與 R-DATA-52 第 7 步的封存（含乾淨主機的 `backups/restored-from-<set>/` 證據），對外驗證保留給 web 上線後的 worker（R-DATA-52 第 6 步）。
    4. 其他 `running`／`commit_uncertain` 的 run 判定為 `abandoned` 並清理。
    5. 校正 `state/lseq`。
  - 清理只刪除沒有被任何地方引用的檔案。引用來源包括：`state.json`（head、serving、previousServing）、保留期內的 release 及其在 commit log 中對應的 lineage、備份集，以及 attempt。
- **R-ARCH-05：提交後步驟**：備份（R-DATA-50）與對外驗證（R-OPS-07）都在 commit 之後執行。提交前資料已經耐久落盤，所以這兩步失敗時只告警並記錄，不會回滾提交。例外：`kind: restore` 的對外驗證延到 web 上線後由 worker 執行（R-DEP-20、R-DATA-52 第 6 步）。
- **R-ARCH-06：查詢語意單一 owner**
  - `@riftversus/domain` 的 SQLite schema v3 與 `searchSqlite`／`compareSqlite` 維持不變，執行環境從瀏覽器的 `sql.js` 換成 server 的 `node:sqlite`。
  - web 從不開啟 canonical DB，因此不會有跨容器共用 WAL 的情況。

### 5.3 Workspace 調整

| Workspace | 變更 |
| --- | --- |
| `packages/contracts` | 新增 API envelope、錯誤碼、release identity、API cursor、單局明細與統計拆解等 schema（皆為 additive） |
| `packages/domain` | 保留 schema v3 與既有查詢；新增單局明細與統計拆解查詢。若因此升級到 v4，web 必須仍能讀取 v3（R-DEP-42） |
| `packages/database` | P1–P4 期間，在 PG 實作旁新增 SQLite 實作。PG 路徑凍結、只修 bug，讓 `publish.yml` 繼續使用；P5 移除 PG 實作與 `pg` 依賴 |
| `packages/sync` | 保留 Leaguepedia provider 與 `FilesystemObjectStore`（以邏輯 key 存放 `body` 與 `metadata.json`）；鎖由呼叫端注入 |
| `apps/data` | 保留 sync、acceptance、export、mapping、freshness；新增 `run`（含 `run media --pack`）、`schedule`、`release`、`backup`、`plan`、`attempt`；P5 退場 GitHub publish／site／archive／checkpoint-release 相關指令（§10） |
| `apps/server`（重建） | HTTP server、API、靜態檔、release 熱切換、`worker` 入口 |
| `apps/web` | 新 UI；以 `http-runtime` 取代 `static-runtime`；保留 `mock-runtime` |

## 6. 部署需求（Docker）

### 6.1 Production image

- **R-DEP-01：多階段建置**
  - 根目錄的 `Dockerfile` 分為三個階段：
    - `deps`：執行 `pnpm fetch`，搭配 `--frozen-lockfile`。
    - `build`：執行 `pnpm build` 並產生 web bundle。
    - `runtime`：執行 `pnpm deploy --prod`。
  - 另有 `legacy-tools` target（§7.6），不屬於 production image。
- **R-DEP-02：runtime 基礎**
  - base image 為 `node:24-bookworm-slim`，以 digest 鎖定 Node 小版本。
  - 以非 root（UID/GID `10001`）執行，`tini` 作為 PID 1，`NODE_ENV=production`。
  - image 內的 `/data` 目錄擁有者為 10001，讓空白 named volume 第一次掛載時繼承這個擁有者。
- **R-DEP-03：不得放入 image 的內容**
  - production image 不得包含 secret、`.env`、PostgreSQL client 或 Chromium。
  - secret 只在 runtime 透過 env file 注入，不得出現在 build arg、`ENV` 預設值或 config summary。
- **R-DEP-04：唯讀 rootfs 與初始化**
  - 容器必須能在 `read_only: true` 的 rootfs 下執行，只有 `/data`（worker）與 `/tmp`（tmpfs）可寫。
  - `riftversus init` 是唯一可以在鎖目錄尚未存在時執行的指令。它依序執行：檢查 `/data` 是否可寫，否則以明確的錯誤結束並提示 bind mount 需要 `chown 10001:10001`；建立 `locks/`；取得鎖；建立其餘目錄結構。重複執行不會改變結果。
  - worker 與 web 啟動時，若目錄結構不完整，拒絕啟動。
- **R-DEP-05：版本資訊**：OCI labels 包含 `org.opencontainers.image.revision`、`version`、`source`；`riftversus version` 輸出同樣的資訊。
- **R-DEP-06：單一 entrypoint**：統一為 `riftversus <command>`。同一個容器不得同時執行 `serve` 與 `worker`。
- **R-DEP-07：資源預算**
  - 上限：未壓縮 image ≤ 300 MB；web 閒置 RSS ≤ 150 MB；worker 閒置 RSS ≤ 150 MB。sync 時的峰值 RSS 需記錄。
  - P2 實測後寫入證據；超出時需在 PR 中說明。

### 6.2 Compose、設定與 base path

- **R-DEP-10：compose 服務**
  - `worker`：
    - 宣告 `build:` 與 `image: ${RIFTVERSUS_IMAGE:-riftversus:local}`，是唯一的 build owner。
    - 執行 `worker`，以讀寫模式掛載 `/data`。
    - healthcheck 為 `riftversus healthcheck worker`。
  - `web`：
    - 只宣告 `image:`，使用相同的變數。
    - 執行 `serve`，對外為 `127.0.0.1:${WEB_PORT:-8080}:8080`。
    - 以唯讀方式掛載同一個 named volume 的 `/data`（`/data:ro`），不使用子路徑掛載。web 不開啟 `db/` 下的任何檔案（R-ARCH-06）。
    - healthcheck 為 `riftversus healthcheck web`。
  - `legacy-import` profile：包含 `postgres:17` 與 `riftversus-legacy-tools`，P5 移除。
  - MinIO 的 `legacy-recovery` profile：P5 移除，但 named volume 一律保留。
- **R-DEP-11：image 一致性**
  - 部署證據必須記錄 web 與 worker 的 image ID 相同。此規則不適用於 legacy profile。
  - 驗收：在乾淨的主機上，照著部署文件依序執行 `docker compose build worker`（或 `pull`）→ `run --rm worker init` → 準備第一個 release（cutover 時依 R-DATA-46 匯入，或依 R-DATA-52 從備份還原）→ `up -d`。
- **R-DEP-12：環境變數設定**
  - 所有設定只來自環境變數。`.env.example` 改寫為「正式部署」與「本機工具」兩區，正式區列出：
    - `PUBLIC_BASE_PATH`、`PUBLIC_ORIGIN`、`DATA_DIR=/data`。
    - 排程：`WORKER_SCHEDULE`、`SYNC_CURRENT_CRON`、`SYNC_HISTORY_CRON`、`SYNC_RUN_TIMEOUT_MINUTES=180`。
    - 保留量：`BACKUP_RETAIN=14`、`ATTEMPT_MAX_BYTES`。
    - `ALERT_WEBHOOK_URL`（可選）。
    - `RIFTVERSUS_IMAGE_DIGEST`（可選）：由主機在部署時注入目前 image 的 digest，供 commit log 與備份記錄。
    - `TRUSTED_PROXY_HOPS`（預設 `1`）：決定從 `X-Forwarded-For` 取哪一跳作為來源 IP，供 rate limit 使用。設為 `0` 時改用連線位址。
    - Leaguepedia 的 endpoint、user agent 與 media hosts。
  - 正式的 competition 範圍與 mapping 不由 env 提供，見 R-OPS-10。
  - 移除 `DATABASE_URL` 與 S3／MinIO 變數。
- **R-DEP-13：儲存限制**
  - SQLite 檔只能放在本機區塊儲存上的 Docker volume 或 bind mount，不支援 NFS、SMB 或雲端同步資料夾；worker 啟動時偵測到網路檔案系統即拒絕啟動。
  - web 與 worker 必須在同一台主機。
- **R-DEP-14：runtime base path**
  - web bundle 不在 build 時寫死 base path。server 回傳 `index.html` 時注入 `<base href>` 與 runtime config，Router 的 `basename` 與資產 URL 都從 runtime config 取得。實作方式在 P2 決定。
  - worker 匯出時，把 `PUBLIC_BASE_PATH` 寫入 release 的 `basePath`。web 遇到 `basePath` 與自身設定不符的 release 時拒絕載入（fail closed，`/readyz` 回報錯誤）。
  - 驗收：同一個 image 在 `/`、`/RiftVersus/`、`/RiftVersus/new/` 三種設定下都通過 E2E。
- **R-DEP-15：舊前綴正規化**
  - 以 path segment 判斷：請求已經落在 `PUBLIC_BASE_PATH` 之下時直接處理。
  - 只有當第一個 segment 是 `RiftVersus`，且請求不在 `PUBLIC_BASE_PATH` 之下時，才移除該 segment、以 308 導向 `${PUBLIC_BASE_PATH}` 加上剩餘路徑，並保留 query。
  - 測試必須涵蓋巢狀前綴與防止導向迴圈。

### 6.3 單一 writer、排程與 run 生命週期

- **R-DEP-20：writer lock**
  - 範圍：所有寫入 `db/`、`releases/`、`media/`、`objects/`、`state/`、`backups/` 的指令，都必須先取得 `/data/locks/writer.lock` 的獨占 `flock`，並持有到提交後步驟結束。這些指令包括：`run *`（含 `run media --pack`）、`migrate`、`release promote|rollback|rebuild --promote|prune`、`backup create|restore`、`attempt prune`。
  - 例外：`backup restore` 分兩段持鎖（R-DATA-52 第 6 步）。restore 指令持鎖到指令內的備份與第 7 步封存完成即釋放；web 上線後，由 worker 重新取鎖完成對帳與對外驗證。兩段之間的寫入由 R-DATA-52 的 restore 閘門管制。
  - candidate 的寫入交易使用 `BEGIN IMMEDIATE`。行程遭硬終止時，flock 由 kernel 釋放。
  - 只有 writer 連線可以寫入；其他連線一律以 `mode=ro` 開啟。
- **R-DEP-21：排程狀態的 owner**
  - `schedule/scheduler.sqlite` 只由 scheduler 模組寫入，不受 writer lock 管轄。scheduler 以自己的短交易寫入，搭配 `busy_timeout`，可跨容器使用。
  - 鎖被占用時，手動指令立即以 `status: locked` 結束並回傳非零 exit code；排程則記錄 `pending`。
  - 每種 run kind 最多一筆 pending，同 kind 新的覆蓋舊的（D10，刻意的行為變更：現行 Actions 讓所有 mode 共用一筆）。
  - 鎖釋放後，多筆 pending 依 `scheduledFor` 由舊到新執行；`scheduledFor` 相同時依 `current`、`history`、`backfill` 的順序。手動指令不進 pending。
- **R-DEP-22：`schedule tick`**
  - 內建排程每分鐘呼叫一次 `schedule tick`；主機 timer 的替代方案呼叫的也是同一個指令（D3）。
  - tick 依 cron 與 `scheduler.sqlite` 判斷要執行哪些項目：到期的 `scheduledFor` 與既有的 pending。能取得鎖就執行，取不到就記錄 pending。
  - 補跑規則：每個 kind 只補最近一次錯過、且晚於該 kind 最後一次結束的 run 的 `scheduledFor`，不補更早的。
  - 紀錄欄位：`scheduledFor`、kind、runId、狀態（`pending|running|succeeded|failed|abandoned|timed_out|commit_uncertain`）、開始／結束時間。
  - `run <kind>` 可加上 `--scheduled-for`，讓手動補跑也有紀錄。
  - 暫停原因：`scheduler.sqlite` 以「原因集合」記錄暫停，每個原因各自設定、各自解除，集合為空才可啟動 run。內建排程與主機 timer 呼叫的 `schedule tick` 都遵守同一個集合。優先順序為 `operator` > `restore` > `attempt_quota`：tick 只執行集合中優先順序最高的原因所允許的動作。
    - `operator`：由 `schedule pause|resume` 設定與解除，升級（R-DEP-30）使用它，優先於其他原因。存在時 `schedule tick` 完全 no-op：不啟動 run、不做保留清理、不重新評估或解除任何其他原因，也不取得 writer lock。
    - `attempt_quota`：由 R-OPS-03 自動設定與解除。只有在原因集合恰為 `{attempt_quota}` 時，tick 才做保留清理與容量重評，以非阻塞方式嘗試取得 writer lock，取不到就跳過。
    - `restore`：由 `backup restore` 設定（R-DATA-52），web 上線後的對外驗證與備份都成功時自動解除，也可用 `schedule resume --reason restore` 手動解除。存在時 tick 不啟動 run、不做清理，也不重新評估或解除 `attempt_quota`，唯一例外是處理 R-DATA-52 登記的 restore：先對帳，再執行待驗證的對外驗證。
    - `schedule resume` 預設只解除 `operator`；之後的下一次 tick 才依實際容量重新評估，符合條件時解除 `attempt_quota`。R-OPS-03 的自動解除只解除 `attempt_quota`。
- **R-DEP-23：逾時**：超過 `SYNC_RUN_TIMEOUT_MINUTES` 時，先送 `AbortSignal`；寬限 60 秒後強制結束，run 記為 `timed_out`。若尚未提交，丟棄 candidate；若已進入提交，依 R-ARCH-04 對帳。
- **R-DEP-24：連線與檔案格式**
  - 每個連線設定 `foreign_keys=ON`、`busy_timeout=5000`。
  - candidate 寫入期間使用 `journal_mode=WAL`、`synchronous=NORMAL`。
  - 提交前執行 `wal_checkpoint(TRUNCATE)`，並切回 `journal_mode=DELETE`，讓 lineage 檔成為單一檔案。

### 6.4 Actions 功能的新 owner

| 現行 Actions 提供 | 新 owner | 需求 |
| --- | --- | --- |
| `schedule` cron | `schedule tick`（D3） | R-DEP-22 |
| `concurrency` 單一 writer 與一筆等待中的 run | writer lock；pending 改為每種 kind 一筆（D10） | R-DEP-20、R-DEP-21 |
| `timeout-minutes: 180` | `SYNC_RUN_TIMEOUT_MINUTES` | R-DEP-23 |
| 失敗 attempt 封存 | `/data/attempts/` | R-OPS-03 |
| 失敗通知 | scheduler 狀態、freshness、webhook | R-OPS-04 |
| secrets／vars 注入、reviewed map 注入 | runtime env file 與 image 內的 repo mapping | R-DEP-03、R-OPS-10 |
| `workflow_dispatch` 各 mode | CLI | §6.5 |
| 每次 run 都從 checkpoint 全新還原 | 每次從 head 建立 candidate，並定期做重建驗證 | R-ARCH-01、R-OPS-05 |
| 候選網站的瀏覽器驗證 | promote 前的 smoke | R-OPS-06 |
| 部署後的身分驗證與 hosted smoke | commit 後的對外驗證 | R-OPS-07 |

- **R-OPS-03：attempt 封存**
  - 建立時機：run 開始時就建立 `attempts/<runId>/journal.jsonl`。每取得一個 raw source 物件，就追加該物件的 key 與 checksum 並 fsync，因此硬終止後仍知道取得了哪些證據。
  - 內容：run 失敗、逾時或 abandoned 時，補齊以下內容，對應現行失敗封存的 staging DB 與索引物件。
    - `manifest.json`：`type: attempt`、kind、`scheduledFor`、失敗階段、image revision、使用的 head，以及 `requests` 陣列。多批 history 的每個 request 各一筆：scope、狀態、失敗階段與錯誤摘要、該 request 取得的物件 key 清單、diagnostics 路徑。
    - 審閱輸入的確切副本：本次 run 實際讀取的 mapping、overrides 與 reviewed 檔案原樣複製到 `attempts/<runId>/inputs/`，並記錄 git revision 與 checksum；不只記版本，所以離線也能取得。
    - `candidate.sqlite`：失敗當下的 candidate，以 SQLite backup API 複製。
    - journal 中列出的 raw source 物件，留在 `objects/` 並由 attempt 釘住。
    - diagnostics。
    - 證據完整度狀態：上述內容都齊全且 checksum 相符時為 `complete`，否則為 `evidence_incomplete`。每個 request 各自標記完整度。`complete` 代表 `attempt show <runId> --request <n>` 可以只用 attempt 目錄與 `objects/`，離線重讀該批次及其審閱輸入。
  - 清理順序：worker 重啟時先依 journal 整理 attempt，之後才做任何清理。journal 中列出的物件由 attempt 釘住，不會被 GC 刪除。
  - 保留優先順序：
    1. 30 天內的 attempt 一律保留。
    2. 超過 30 天的 attempt，只保留最近 30 筆。
    3. 若 30 天內的 attempt 總量超過 `ATTEMPT_MAX_BYTES`，worker 暫停排程並告警（fail closed），不得刪除 30 天內的證據。
  - 超量時設定 `attempt_quota` 暫停原因（R-DEP-22）。只有原因集合恰為 `{attempt_quota}` 時，`schedule tick` 才執行上述保留清理與容量重評，且不啟動 run。總量回到上限以下時（attempt 超過 30 天後被清理，或維運者調高 `ATTEMPT_MAX_BYTES`），下一次 tick 只解除 `attempt_quota` 並記錄事件；其他暫停原因不受影響。`operator` 或 `restore` 存在期間不清理也不重評，容量的重新評估延到它們都解除之後的下一次 tick。
  - 使用限制：`backup restore` 與 `release promote` 拒絕任何 `type` 不是 `backup`／`release` 的輸入。
  - 查閱：用 `riftversus attempt show <runId>` 重讀失敗證據。
- **R-OPS-04：通知**
  - 觸發條件：run 失敗、逾時、abandoned、`commit_uncertain`，freshness 不健康，提交後步驟失敗，或 attempt 容量超限。
  - 若有設定 `ALERT_WEBHOOK_URL`，就 POST 一筆不含 secret 的 JSON。
  - worker healthcheck 也反映 freshness 狀態。
- **R-OPS-05：重建驗證**
  - 每週 history 之後，執行 `release rebuild --verify`（預設 `--from serving`）：從 `serving.lseq` 重新匯出，與 `serving.releaseId` 對應的 release 比對。
  - 判定規則：
    - 相同 `basePath` 下，`snapshotId` 必須嚴格相等。
    - 若 exporter 版本與該 release 的 `servingExporter.imageRevision` 相同，`releaseId` 也必須相等。
    - 若 exporter 版本不同，只要求 `snapshotId` 相等，並記錄 `releaseId` 的差異。
  - `--verify` 不得推進任何指標。不一致時告警。
- **R-OPS-06：promote 前 smoke**：對候選 release 啟動 in-process server，驗證以下項目：
  - `meta`。
  - 預設比較與 acceptance fixture（T1 vs LPL Worlds BO5）。
  - 搜尋、單局明細。
  - manifest 列出的所有媒體。
  - image credits。
- **R-OPS-07：commit 後對外驗證**
  - 透過 `PUBLIC_ORIGIN` 與 `PUBLIC_BASE_PATH` 驗證，整輪總逾時 120 秒。
    1. 輪詢 `/api/v1/meta`，`releaseId` 必須等於新的 serving release。最多試 15 次，每次間隔 2 秒，與現行 `verifyDeployedIdentity` 相同。
    2. 預設比較回應的摘要必須等於 smoke 的結果。
    3. 抽查一個媒體檔與 credits 頁，並檢查 CSP header。
  - 失敗時告警並寫入 attempt。回復方式是依書面步驟執行 `release rollback`；不自動回滾。
- **R-OPS-10：正式排程計畫**
  - 正式的 current／history scope 由 image 內的 `data/leaguepedia/competition-map.json` 產生，competition 預設為 `MSI,LCK,LPL,EWC`。
  - 延續現行的年度 gate：
    - current 只能跑當下 UTC 年度，並且必須有該年度的 reviewed mapping。
    - 跨年時，在新年度的 mapping 審閱並 commit 之前，current fail closed，不得沿用前一年。
  - `riftversus plan show` 輸出實際生效的 scope；排程啟動時，若缺少 mapping 或設定過期，拒絕執行並告警。
  - 測試必須涵蓋跨年、設定過期與缺少 mapping。

### 6.5 指令對照

| 現行 | 新指令（皆在 production image 內） |
| --- | --- |
| `publish.yml` mode `current`／`history`／`backfill` | 排程，或 `riftversus run current|history|backfill …` |
| mode `media` | `riftversus run media --pack <zip>`：在同一個 run 內驗證、匯入並發布 |
| mode `reexport`（在 migration 後產生新的資料提交） | `riftversus migrate`：以 head 產生新的 lineage 並推進 head；接著 `riftversus release rebuild --from head --promote` 匯出並切換 serving |
| mode `rebuild`（從最新資料重新匯出，不推進 data lineage） | `riftversus release rebuild --from head --promote`：從 `head.lseq` 重新匯出並切換 serving，不改 head。rollback 之後要回到最新資料也用這個指令 |
| mode `rollback` | `riftversus release rollback [<releaseId>]`、`release list` |
| `checkpoint pack|verify|restore` | `riftversus backup create|verify|restore` |
| —（新增） | `riftversus init|schedule tick|schedule pause|resume|plan show|attempt list|show|prune|release prune|healthcheck` |
| —（遷移專用，在 legacy 工具 image 內） | `riftversus-legacy fetch-checkpoint|import-postgres|parity|site-download` |

`release rebuild` 接受 `--from head|serving|<lseq>`：`--promote` 預設 `--from head`，`--verify` 預設 `--from serving`。`run <kind>` 每次提交都同時推進 head 與 serving，所以 rollback 之後的下一次 run 會讓 serving 回到最新資料。

`run <kind>` 的管線（全程持有 writer lock）：

1. 取得鎖，並寫入 attempt journal。
2. 從 head 建立 candidate。
3. 寫入 candidate。
4. 匯出到 `releases/.staging-<runId>/`。
5. 執行 acceptance：移植到 SQLite 的 `current-snapshot-acceptance`（R-DATA-42），讀取匯出的成品、candidate 與物件。
6. 執行 `release verify` 與 smoke。
7. 耐久落盤並 commit（R-ARCH-03）。
8. 執行提交後步驟（R-ARCH-05）。

若在 commit 之前失敗，丟棄 candidate 與 staging、寫入 attempt，`state.json` 保持不變。若在 commit 之後失敗，依 R-ARCH-04 對帳。純驗證指令（`--verify`、`backup verify`、`plan show`）不得推進任何指標。

- **R-OPS-08：多批 history**：同一個 run 中若有多個 request，只要任一個失敗，就丟棄整個 candidate，所有失敗原因依 request 分別寫入同一份 attempt（R-OPS-03 的 `requests`）。這與現行 `AggregateError` 的語意相同。
- **R-OPS-09：media-only 防護**
  - `run media` 不得改動以下受保護的表：
    - `entities`、`entity_aliases`、`team_eras`、`team_region_history`、`tournaments`。
    - `series_facts`、`game_facts`、`game_players`。
    - `entity_public_ids`、`team_era_public_ids`。
    - `coverage_status`、`fact_mutation_audits`、`source_cursors`。
  - 只允許以下差異，各表的所有其他差異都 fail closed：
    - `sync_runs`：新增一筆 `mode='media'` 的列，以及該列從 `running` 轉為 `succeeded` 的狀態欄位更新。
    - `source_objects`：只新增 reviewed-media manifest。
    - `override_applications`／`override_application_runs`：只新增綁定 `data/overrides/media.json` 的列。
    - `dataset_versions`：至多新增一筆，coverage 與 current／history freshness 欄位都必須與前一筆相同。若 manifest 與已發布的相同，就不新增（沿用現行的無變更語意）。
    - `media_objects`：只新增。
    - `media_assets`：新增列，以及 `is_current` 的切換。切換必須精確綁定同一個主體（`entity_id` 或 `team_era_id`）與同一個 `kind`，其他欄位不得更動。
  - 驗證方式：比對 candidate 與 head，違反上述規則即 fail closed。

### 6.6 升級

- **R-DEP-30：升級程序**
  - 依序執行，每一步失敗就停止並保留現狀：
    1. `docker compose build worker`（或 `pull`）。
    2. 停寫：執行 `riftversus schedule pause` 設定 `operator` 暫停原因（R-DEP-22；內建排程與主機 timer 的 `schedule tick` 都會完全 no-op），再 `docker compose stop worker`。舊 writer 與 migration 不得同時執行；從這一步到第 7 步之前，不得有任何 sync 寫入。
    3. `docker compose run --rm worker migrate`：先自動建立備份集，再以 head 產生新的 lineage 並推進 head。serving 仍指向舊 release。
    4. `docker compose up -d web`：新 image 的 web 先讀取既有的 serving release（R-DEP-42 保證 N 能讀 N-1 的 release），`/readyz` 必須健康。到這一步為止，新 lineage 尚未對外 serving，仍可依 R-DEP-41 回到舊 image。
    5. `docker compose run --rm worker release rebuild --from head --promote`：以新 image 從新的 head 匯出，通過 acceptance 與 smoke 後切換 serving；新 web 熱切換，並通過 R-OPS-07。
    6. 對正式 origin 執行 release 版 E2E（D8）。
    7. 以上都通過後，`docker compose up -d worker` 並執行 `riftversus schedule resume`，恢復原本的排程。
  - worker 偵測到尚未執行的 migration 時，拒絕啟動排程。

### 6.7 回復路徑與相容矩陣

- **R-DEP-40：serving rollback**
  - `release rollback [<releaseId>]` 只改變 `serving` 與 `previousServing`，不改變 `head`，也不更換 image。
  - 寫入歷史不倒退：之後的 run 仍從 head 繼續；已發布的 facts、稽核與 public ID 擁有權都保留，`lseq` 也不會碰撞。
  - 若要修正 head 中的錯誤資料，必須走新的 run（correction／override），或依 R-DATA-52 做災難還原。
- **R-DEP-41：image rollback**
  - 在新 image 產生的 lineage 尚未對外 serving 之前：可以先 `backup restore` 到 migration 前的備份集，再回到舊 image。尚未 serving 的新寫入會連同其引用的物件，一起保存到 `backups/abandoned-<ts>/`，不刪除。
  - 新 lineage 已經對外 serving 之後：只能 fix-forward，也就是修正後發布新的 image，不得降版。災難情境的例外依 R-DATA-52 處理。
- **R-DEP-42：相容矩陣**
  - image N 必須能讀取 release schema v3，以及 N 引入的任何新 schema。
  - image N 必須能讀取 image N-1 產生的 release。
  - image N-1 遇到不支援的 schema 時必須拒絕載入。
  - P2 與每次 image 升級時，都要演練「N-1 image 讀 N 產生的 release」與「N image 讀 N-1 產生的 release」兩種組合。
- **R-DEP-43：舊靜態 site 封存**
  - P5 後，私有 Release 中 schema 2／3 的 immutable site 轉為歷史證據。
  - cutover 後 30 天內，保留可執行的緊急復原能力：
    - legacy 工具 image 的 `site-download` 與封存驗證能力保留到期限屆滿。
    - 復原入口是 D6 的 `gh-pages` 分支，不依賴 `publish.yml`：以 `site-download` 取件並驗證後，把封存的 site 提交到 `gh-pages`；返回時再提交遷移頁。
    - P5 之前要用這條分支路徑演練一次完整流程：取件、驗證、發布封存 site、以真實的舊 origin 驗證，再切回遷移頁。不得以舊 workflow 代替。
  - 30 天後，由 ADR-0002 宣告這項相容契約終止，並刪除 legacy 工具 image。

## 7. 資料需求（SQLite）

### 7.1 Canonical schema

- **R-DATA-01**：以單一 SQLite baseline migration `sqlite/001_baseline`，重建 PG migration 001–014 最終狀態的 21 張表，另外新增 2 張 SQLite 專用的 reservation 表（R-DATA-16）。21 張表的表名、欄位與約束語意都要與 PG 等價：

  ```text
  coverage_status, dataset_versions, entities, entity_aliases, entity_public_ids,
  fact_mutation_audits, fact_mutation_authorizations, game_facts, game_players,
  media_assets, media_objects, override_application_runs, override_applications,
  series_facts, source_cursors, source_objects, sync_runs, team_era_public_ids,
  team_eras, team_region_history, tournaments
  ```

  P5 之前，PG migrations 保留在原位。
- **R-DATA-02**：所有表都使用 `STRICT`，並移植全部的 CHECK、UNIQUE 與 FK。SQLite 專用的欄位（`*_fold`、授權的 `id` 與 `state`、`legacy_*`）與 reservation 表，列在 R-DATA-42 的欄位映射表。
  - `dataset_versions.sync_run_id → sync_runs` 與 `sync_runs.reused_dataset_version_id → dataset_versions` 互相引用，任何逐表順序都無法一次滿足 FK。批次匯入（R-DATA-41）與備份還原必須在單一交易內設定 `PRAGMA defer_foreign_keys=ON`，commit 前執行 `foreign_key_check`。

### 7.2 型別與功能差異

| PG 功能（使用處） | SQLite 處理 | 驗收 |
| --- | --- | --- |
| `ilike` 搜尋（`repositories/entities.ts`） | 寫入時另存 `*_fold` 欄位（NFKC 加 Unicode lowercase，由 app 計算）。查詢時對 fold 欄位用 `=` 或 `LIKE … ESCAPE '\'`。SQLite 的 `LIKE` 只對 ASCII 不分大小寫，不得直接用在原始欄位 | 韓文、中文、全形字元，以及名稱含 `%`／`_` 的測試 |
| `pg_trgm`（migration 008） | 不移植。若量測顯示需要，改用 FTS5 `trigram`（已確認 Node 24.12 內建的 SQLite 3.50.4 支援） | 搜尋延遲的量測證據 |
| advisory lock（`repositories/sync.ts`） | writer lock（R-DEP-20） | 併發測試 |
| PL/pgSQL trigger 與交易本地授權 | 見 §7.3 | 見 §7.3 |
| `jsonb` | `TEXT`，加上 `CHECK (json_valid(col))`，以穩定的鍵序序列化 | round-trip 測試 |
| `date` | `TEXT`，以 GLOB CHECK 限定 `YYYY-MM-DD` 格式，並由 `DateSchema` 驗證 | 沿用日期邊界測試 |
| `timestamptz` | `TEXT`，ISO-8601 UTC，固定 6 位小數（微秒），與 PG 的精度相同，遷移不失真 | 時區、排序與微秒 round-trip 測試 |
| `boolean` | `INTEGER`，加上 `CHECK (col IN (0,1))`；parity 時 PG 的 `true/false` 正規化為 `1/0` | — |
| `bigint`（含 generation sentinel `9223372036854775807`） | `INTEGER`（64-bit）。generation 類欄位一律以 `BigInt` 讀取，不得轉成 `Number`；其他欄位若超出 `MAX_SAFE_INTEGER`，fail closed | sentinel round-trip |
| `uuid` | `TEXT`，加上格式 CHECK | — |
| `pg_dump`／`pg_restore` | 備份集（§7.7） | 還原演練 |

- **R-DATA-03：驅動選擇**
  - 優先使用 Node 內建的 `node:sqlite`，並為 Kysely 撰寫 dialect adapter。若相容性、交易、BigInt 或效能不足，改用 `better-sqlite3`。由 P1 PR 以證據定案。
  - `node:sqlite` 目前仍是 experimental：必須鎖定 Node 小版本，每次升級都要跑完整測試。

### 7.3 寫入保證（取代 PL/pgSQL）

- **R-DATA-10：交易本地的事實修改授權**
  - 交易邊界：SQLite 只有單一 writer 連線，一次只有一個寫入交易；「交易本地」指的是同一個寫入交易內插入、且尚未 commit 的列。
  - `fact_mutation_authorizations` 欄位：`id`、`fact_table`（`series_facts|game_facts`）、`fact_id`、`provenance_kind`（`source_object|override_application`）、`provenance_id`、`state`（`active|consumed|historical`）、`created_at`，以及 `legacy_*` 欄位。另建部分唯一索引：`state='active'` 時，每個 `(fact_table, fact_id)` 最多一筆。
  - 寫入 API `authorizeFactMutation` 的流程：
    1. 先比較既有列與新值。內容完全相同時不授權、也不執行 UPDATE，保持 no-op。
    2. 內容不同時，在同一交易內插入 `active` 授權，接著執行 UPDATE。
  - 必須成立的不變式（綁定與消費的具體機制在 P1 定案，見 §14）：
    - **唯一建立途徑**：只有 writer 連線上的 `authorizeFactMutation` 能建立授權；其他連線都以 `mode=ro` 開啟。
    - **交易綁定**：授權只對建立它的那個寫入交易有效。即使內容相同，也不能被另一個交易使用。
    - **精確比對**：`BEFORE UPDATE` trigger 要求 `fact_table` 等於 trigger 所屬表、`fact_id` 等於 `OLD.id`，並依 `provenance_kind` 精確查找：`source_object` 對 `source_objects.id`，`override_application` 對 `override_applications.id`。任何一項不符就 `RAISE(ABORT)`。
    - **只消費一次**：通過檢查時，把該授權改為 `consumed`，並寫入 `fact_mutation_audits`。
    - **無殘留**：commit 前斷言本交易沒有 `active` 授權，有則 rollback；每個寫入交易開始時，也確認沒有已 commit 的 `active` 授權，有則中止並告警。
    - **稽核不倒退**：事實的首次插入與退役（`retired_generation`）留下的 provenance 稽核，範圍不得少於 PG 現行行為；P1 依 PG integration test 列出並移植。
- **R-DATA-11：append-only 與不可變**
  - 以下 6 張表以 `BEFORE UPDATE/DELETE` trigger 無條件拒絕修改，與 PG 相同、沒有例外：`source_objects`、`override_applications`、`override_application_runs`、`fact_mutation_audits`、`media_objects`、`dataset_versions`。
  - 可變的狀態表（例如 `sync_runs` 的狀態欄位、`media_assets.is_current`）不在此列，其變更範圍由寫入 API 與 R-OPS-09 規範。
- **R-DATA-12：public ID 與實體類型**
  - 以下操作一律被拒絕：對 `entity_public_ids`／`team_era_public_ids` 執行 `UPDATE`／`DELETE`；把已發布的 ID 改綁到其他主體。
  - 類型約束逐欄移植 `001_initial.ts` 的 `riftversus_enforce_entity_kinds`，在 `INSERT` 與 `UPDATE` 時檢查：
    - `team_eras.team_entity_id`：`team`。
    - `series_facts`／`game_facts`：`side_a_team_id`、`side_b_team_id`、`winner_team_id` 為 `team`；`side_a_region_id`、`side_b_region_id` 不為 null 時為 `region`。
    - `game_players`：`player_entity_id` 為 `player`，`team_entity_id` 為 `team`。
    - `team_region_history`：`team_entity_id` 為 `team`，`region_entity_id` 為 `region`。
- **R-DATA-13：歷史授權紀錄**：從 PG 匯入的授權與稽核歷史列，`state` 設為 `historical`，原本的 `transaction_id`／`backend_pid` 存到 `legacy_transaction_id`／`legacy_backend_pid`。這些列不參與執行期授權。
- **R-DATA-14：拒絕測試**：PG integration suite 中所有「非法寫入必須被拒絕」的測試都要移植並通過。另外新增：
  - 跨交易殘留的授權，以及同一事實在另一個交易中以相同內容再次授權。
  - `provenance_kind` 與 provenance 所在的表不符。
  - R-DATA-12 每一個欄位的錯誤 kind。
  - 竄改來源或稽核紀錄、從唯讀連線寫入。
  - no-op upsert 不留下殘留授權；首次插入與退役的稽核範圍與 PG 相同。
- **R-DATA-15：publication generation 與 gate**
  - 保留 `dataset_versions`（append-only）與 publication generation 的語意。
  - corrections、alternative game review、identity overrides 的載入與 checksum 方式不變。
  - 既有的 fail-closed gate 不得放寬：mapping 缺漏、redirect 目標缺少 player dimension、BO2／格式證據、partial coverage、awarded score。
- **R-DATA-16：public ID 保留（reservation）**
  - `sqlite/001_baseline` 新增兩張 SQLite 專用的表：`entity_public_id_reservations`（public ID、kind、原主體 UUID、`reserved_at`、來源）與 `team_era_public_id_reservations`（public ID、team scope、原 era UUID、`reserved_at`、來源）。
    - 兩張表都不對 `entities`／`team_eras` 建 FK，所以能保留目前 DB 中尚不存在的主體。
    - 它們是 append-only，不參與 PG parity（PG 沒有對應的表，cutover 時為空）。
  - 配置器（`ensurePublicIds`）的規則，依序判斷：
    1. 先依主體 UUID（與 kind 或 team scope）查詢既有的 `*_public_ids` 與 reservation。只要找到，就取回同一個 key，不產生新 key。主體更名後也一樣。
    2. 找不到時，才依名稱產生候選 key。候選 key 已在 `*_public_ids` 或 reservation 中屬於其他 UUID 時，視為已被占用，改用下一個候選。
  - 雙向唯一：在同一個 namespace（kind 或 team scope）內，`*_public_ids` 與 reservation 合起來必須同時滿足「一個 key 只對應一個 UUID」與「一個 UUID 只對應一個 key」。配置與還原都依這兩個方向檢查。
  - 主體重新出現並認領 key 後，reservation 列保留不刪（append-only），之後以 `*_public_ids` 為準。
  - 被保留、但主體目前不存在的 readable 連結，依 §8.1「未知的 readable ID」處理：留在 URL 上並顯示復原提示。

### 7.4 Release 成品

- **R-DATA-20：成品內容**
  - `releases/<releaseId>/` 包含：
    - 既有 exporter 的輸出（`data/manifest.json`、SQLite、`presentation/` 媒體與 `image-credits.html`）。
    - `release.json`。
    - `install.json`：安裝紀錄（R-ARCH-02），不屬於識別欄位。
  - `release.json` 只含 R-ARCH-02 的識別欄位，以及由內容推導的 `datasetVersion`、`coverage`；逐次執行的 metadata 在 commit log。
- **R-DATA-21：credits 與 CSP**：`image-credits.html` 改用外部的 `presentation/credits.css`，不再使用 inline `<style>`，以符合 R-API-05 的 CSP（現行 `media-credits.ts` 用的是 inline style）。
- **R-DATA-22：prune 保留範圍**
  - `release prune` 保留下列 release，以及它們引用的媒體和 commit log 中對應的 lineage 檔：
    - 最近 10 個 release。
    - `serving` 與 `previousServing`。
    - 依 commit log 推導、仍在 24 小時保留期內的 release（R-ARCH-03）。
  - lineage 檔另外保留 `head` 與所有備份集引用到的檔案。

### 7.5 媒體

- **R-DATA-30：發布資格**：沿用 ADR-0001 與 2026-10-04 amendment。
  - 有 license 的媒體可以發布。
  - `license=null` 的媒體，必須有結構化的 editorial rights basis、file page/revision、經審閱的 checksum、rights statement、attribution，以及精確的 player／team-era 綁定，才能發布。
  - 圖片內容變更後，不得沿用先前的審閱結果。
  - region 一律使用生成頭像；其他媒體 fail closed。
- **R-DATA-31：`run media --pack <zip>`**
  - `<pack>` 限定為受審的 ZIP。受信任的 checksum 只來自 repo 中已審閱的 `data/overrides/media.json`：
    - 整包：`archive.checksum` 與 `archive.byteSize`。
    - 逐檔：`assets[].rightsBasis.fileChecksum` 與 `assets[].byteSize`。
    - `media-inventory.json` 只是統計與缺圖清單，不含 checksum，不作為信任來源。pack 自帶的 checksum 只用來檢查內部一致性。
  - 驗證項目：
    - 整包與逐檔 checksum、大小都必須等於 `media.json` 中的值，檔名集合必須完全一致。
    - 大小上限、MIME 類型與圖片尺寸。
    - 每個主體綁定都存在於 canonical。
    - credits 欄位齊全。
  - 全部通過才以 `putImmutable` 寫入 object store，並記入 attempt journal（R-OPS-03），因此在 run 提交或失敗封存之前都不會被 GC。任何一項不符，整包拒絕。
- **R-DATA-32：生成頭像**：deterministic avatar 在 export 時生成，不寫入 `media_objects`，也不構成 provenance。

### 7.6 一次性遷移與 cutover 交接

- **R-DATA-40：legacy 工具 image**
  - 以 `Dockerfile` 的 `legacy-tools` target 建置，內含 `postgresql-client-17` 與 PG 版的 `apps/data`，只在 `legacy-import` profile 中搭配 `postgres:17` 使用。
  - `RIFTVERSUS_DATA_TOKEN` 只在執行當下注入。
- **R-DATA-41：匯入範圍**（輸入是鎖定的 checkpoint，或 R-DATA-46 第 1 步的已驗證本機來源）
  1. 在 PG 17 還原 checkpoint dump，或已驗證本機來源的 dump。
  2. 在單一交易內把 21 張表複製到 SQLite lineage `lseq=1`。交易中設定 `PRAGMA defer_foreign_keys=ON`，以處理 `dataset_versions` 與 `sync_runs` 的雙向引用（R-DATA-02）；commit 前執行 `foreign_key_check`。
  3. 透過 `putImmutable`，把遷移輸入（checkpoint，或已驗證本機來源的封存）的所有物件（raw source、retained／reviewed media）連同邏輯 key 與 `metadata.json` 寫入 `objects/`。
  4. 與 `source_objects`／`media_objects` 對帳 key、checksum、大小與類型：每個 DB 參照都要有物件，每個物件都要有參照或列在白名單。
  5. 被引用的媒體位元組，以遷移輸入自身的 `media_objects`（checksum、大小、類型）與 `media_assets` 的權利紀錄驗證，不只依目前的 `media.json`，因此也涵蓋舊 checkpoint 保留、但不在目前 pack 的物件。遷移輸入缺少的審閱媒體位元組，從私有 media Release 取得，再套用同樣的驗證。
- **R-DATA-42：cutover parity gate**（以下全部成立才算通過）：
  - **匯出比對**：以 PG 路徑與 SQLite 路徑，在相同 `basePath`（目前為 `/RiftVersus/`）與相同 exporter 版本下分別匯出，兩者的 `snapshotId` 相等；若現行 Pages site 來自同一份 checkpoint，也必須等於該 site manifest 的 `snapshotId`。
  - **逐表比對**：每張表的 row count 相等。依下方的欄位映射表正規化後，按 PG 原有的主鍵（複合鍵依其欄位順序）排序，算 sha256，兩邊必須相等。
    - 正規化：JSON 以穩定鍵序序列化；時間從 PG 以 UTC、6 位小數的文字取出，與 SQLite 的值逐字比對，不先轉成毫秒；BigInt 轉為十進位字串；boolean 轉為 `1/0`。
  - **欄位映射表**：

    | 表 | SQLite 欄位 | 處理 |
    | --- | --- | --- |
    | `fact_mutation_authorizations` | `legacy_transaction_id`、`legacy_backend_pid` | 對應 PG 的 `transaction_id`、`backend_pid`，納入雜湊與排序鍵，以重建 PG 的複合主鍵 |
    | `fact_mutation_authorizations` | `id`、`state` | SQLite 專用，不納入雜湊；匯入的列 `state` 必須全部為 `historical` |
    | `entities`、`entity_aliases` 等有搜尋欄位的表 | `*_fold` | 不納入雜湊；必須等於 fold(來源欄位) |
    | `entity_public_id_reservations`、`team_era_public_id_reservations` | 整張表 | 不參與 parity；cutover 時必須為空 |
    | 其餘所有表與欄位 | 與 PG 同名 | 全部納入雜湊 |
  - **public ID**：`entity_public_ids`／`team_era_public_ids` 完全一致，legacy UUID 與 readable 連結解析到相同主體。
  - **物件**：對帳沒有缺漏。
  - **乾淨 volume 驗收**：在乾淨的 volume 上，以遷移結果跑完整的 current snapshot acceptance、來源與歷史結果驗收、媒體與 credits 驗收。
  - **acceptance 移植**：`current-snapshot-acceptance` 的驗收規則與成品讀取器（`verifyPublicSnapshot`）保留；它目前透過 PG 執行的 canonical 查詢（最新 generation、dataset 狀態、重做 projection、fact provenance、媒體 metadata），P1 移植到 SQLite repository 介面。驗收：以 production image 在沒有 PG 的環境跑正例，並有錯誤 generation、缺少 provenance、媒體不符三種拒絕測試。
- **R-DATA-43：archival acceptance（獨立的證據）**：移植到 SQLite 的 `acceptance:archival`，它不是最新 checkpoint parity 的條件。輸入來源分成兩種：
  - **PR CI**：使用 repo 內已提交、不含私有資料的 synthetic fixture，形狀與 gen-4 相同，不需要任何 secret。
  - **真實 gen-4 checkpoint**：由維運者在 P1 與 cutover 時，以 legacy 工具 image 注入 token 後驗收並留存證據。轉換後的 gen-4 SQLite 檔存入私有備份集，至少保留到 R-DEP-43 的期限屆滿，P5 之後仍可重跑。
- **R-DATA-44：base path 切換**：parity 通過後，以新的 `PUBLIC_BASE_PATH` 重新匯出。把媒體 URL 前綴正規化之後，`snapshotDigest` 必須相等。
- **R-DATA-45：shadow volume 隔離**：P3 的 shadow run 使用獨立的 `riftversus-shadow` volume，不會變成正式資料。
- **R-DATA-46：cutover 交接順序**（依序執行，每一步都留存證據）：
  1. **盤點並處理未發布資料**：以 R-DATA-42 的逐表雜湊與物件清單，比較所有可能持有未發布資料的 DB（例如維運者本機的 PG）與最後一份 verified checkpoint。比對範圍是 canonical 的 21 張表與物件，不只是公開的 `snapshotId`，因此也涵蓋未投影的稽核與來源紀錄。若有差異：
     - 把確切的 DB、引用物件與審閱輸入打包並附 checksum，存入 `backups/pre-cutover-local-<ts>/`。
     - 不以重抓 scope 的方式重播：重抓會產生新的 run、時間與稽核身分，無法原樣重現。
     - 改走受控的「已驗證本機來源」匯入，讓這些資料原樣成為遷移輸入（G6）：
       1. 該 DB 必須是鎖定 checkpoint 的同源後繼。判定以 append-only 的發布歷史為準，不要求每一列都不變：
          - R-DATA-11 的 6 張 append-only 表與 public ID 表：checkpoint 的每一列在該 DB 中都存在且正規化後完全相同，只能多出新列。
          - 該 DB 的 `dataset_versions` 必須延續 checkpoint 最新的 generation，不得在同一個 generation 有不同的版本。
          - 寫入 API 合法更新的欄位可以與 checkpoint 不同，例如 `media_assets.is_current`、`sync_runs` 狀態、`source_cursors`、`entities` 的真名採納與 `player_id` 補齊、`game_players`；完整清單在 P1 依現行 repositories 列出。經授權修改的 fact 也可以不同，但每一筆 fact 差異都必須由 checkpoint 中沒有的新增 `fact_mutation_audits` 逐筆證明：依 `audit_id` 排序後，第一筆的 `old_payload` 等於 checkpoint 中該 fact 的列；checkpoint 中不存在的 fact，第一筆必須是新增時寫入、`old_payload` 為 `{}` 的 audit（現行 `upsertSeries`／`upsertGame` 的行為）。之後每一筆的 `new_payload` 等於下一筆的 `old_payload`，最後一筆的 `new_payload` 等於該 DB 中的現值（都以正規化後的 payload 比較；新增 audit 只記錄寫入的欄位，比較欄位清單在 P1 定義）；每筆 audit 引用的 `source_objects` 或 `override_applications` 都存在於該 DB，並通過來源驗證。判定不依 generation，所以 generation 不變的授權修正（例如只改 `played_at`，見 `migrations.integration.test.ts`）也算同源。
          - 不符合以上任一項，就是分岔，不走這條路徑，改依下方的分岔處理（D11）。
       2. 在 legacy 工具 image 中，以該 DB 跑完整的 current snapshot acceptance、來源與歷史結果驗收，並與引用物件對帳，全部通過。
       3. 第 4 步改以該 DB（而不是 checkpoint）作為 R-DATA-41 的輸入，R-DATA-42 的 parity 也以它為比對對象。匯出比對時不要求等於 Pages 的 `snapshotId`，改為等於 legacy 路徑對同一份 DB 的匯出。
       4. 驗收：封存中每一張表依主鍵正規化後的 hash（包括稽核與來源紀錄），必須等於遷移後 SQLite 對應的 hash；物件集合相同。
     - **輸入綁定**：第 1 步的判定（同源後繼或分岔）、差異紀錄與核准，都綁定第 3 步最終鎖定的 checkpoint ID 與本機封存的 checksum。第 3 步鎖定的 checkpoint 與第 1 步比對時不同，或封存的 checksum 改變，就重做第 1 步，包括重新核准。
     - **分岔處理（D11，G6 的明文例外）**：本規格不提供兩條已分岔 lineage 的自動整併，因為同一個 `generation` 的兩個版本無法在 append-only 的 publication 模型中同時成立。處理方式：
       - 遷移輸入固定為正式 checkpoint。
       - 分岔的本機 DB、引用物件與審閱輸入，完整、原樣地保存在 `backups/pre-cutover-local-<ts>/`：附 checksum，永久保留，不受 GC 影響，並納入異地同步。
       - 決策紀錄逐表列出兩邊的差異（依 R-DATA-42 的逐表雜湊與差異列），由使用者在 cutover 前核准。
       - cutover 後，對應的 scope 以新的 run 重新取得，會產生新的 run、時間與稽核身分；這部分不宣稱與封存原樣相同。
     - 封存（`backups/pre-cutover-local-<ts>/`）無論如何都保留，作為來源證據。
  2. **凍結舊 writer**：把 `PUBLISH_ENABLED` 設為 `false`，確認沒有排隊中或執行中的 `publish.yml`，也沒有 Pages deployment。
  3. **鎖定 checkpoint**：用 `archive resolve` 鎖定最後一份 verified checkpoint，記錄其 ID、sequence 與 series 數。若第 1 步選用已驗證本機來源，也在此鎖定該 DB 與封存的 checksum，並重新確認它仍是這份 checkpoint 的同源後繼（輸入綁定規則見第 1 步）。
  4. **重新遷移**：在正式 volume 上以鎖定的遷移輸入（checkpoint，或第 1 步的已驗證本機來源）重做 R-DATA-41、R-DATA-42、R-DATA-44，並從 `lseq=1` 建立第一份 `state.json`，由 head 與 serving 同時指向它。
  5. **5a：只啟動 web**：以 `WORKER_SCHEDULE=off` 執行，透過正式 HTTPS 完成 §9.3 的第 3–6 項。
  6. **5b：啟用 worker 排程**：第一次由新 writer 執行的提交必須通過 R-OPS-07。若這次提交已經耐久落盤、但 R-OPS-07 失敗，cutover 進入「5b 受阻」狀態：設定 `WORKER_SCHEDULE=off`，`release rollback` 到第 4 步的第一個 serving release，head 與新寫入的資料保留不動，修正後以新的 run 或新的 image 繼續（fix-forward），不回到 Actions。
  7. **部署 Pages 遷移頁**（§8.6）。
  - 退回規則：
    - 在 5b 之前：把 `PUBLISH_ENABLED` 改回 `true` 即可退回舊路徑，因為舊資料完全沒有被修改。
    - 在 5b 之後：不再回到 Actions。回復手段是 serving rollback 與備份集；最後的退路是 R-DEP-43 的唯讀靜態站緊急復原。

### 7.7 備份集

- **R-DATA-50：`backup create`**
  1. 以 SQLite backup API 複製 `head` 的 lineage；若 `serving.lseq` 與 `head.lseq` 不同（例如 rollback 或單獨 `migrate` 之後），也複製 `serving.lseq` 的 lineage。
  2. 對每個複製的 lineage 執行 `integrity_check` 與 `foreign_key_check`。
  3. 寫入 `manifest.json`，欄位如下：
     - `type: backup`、`commitSeq`、`maxLseq`（備份當下 `state/lseq` 的值），以及建立備份的 image revision。
     - `head`：`lseq`、DB sha256，以及取自 `state.json` 的 `schemaVersion` 與 `producer`。
     - `serving`：`releaseId`、`installId`、`lseq`、DB sha256、`schemaVersion`、`snapshotId`、`basePath`，以及取自 `state.json` 的 `servingExporter`。
     - 物件清單：兩個 lineage 引用的所有物件，`{ key, checksum, contentType, byteSize, file }` 的陣列。
     - commit log 快照：備份當下、經 R-ARCH-04 驗證完整且連續的 `state/commit-log.jsonl` 副本與同一時點的 `state.json` 副本，附 sha256。快照只作為來源證據；它引用的歷史 release 與 lineage 不在備份範圍內，還原時不作為可執行的歷史（R-DATA-52）。
  4. 物件以內容定址方式增量複製到 `backups/objects/<sha256>`。serving release 目錄的檔案也一併納入。
  5. fsync 後，改名為 `backups/<ts>-c<commitSeq>/`。
  - 結果：任一備份集加上 `backups/objects/`，就能在沒有 `/data` 的情況下，還原當時的 head、serving 及其 lineage、物件與 serving release，之後的每週重建也有輸入。備份不包含其他歷史 release；乾淨主機還原後，rollback 只能回到備份中的 serving release。
  - image 可取得性：備份記錄的每個 `imageRevision`，都必須能從已審核的 git revision 重新 build（D2），或由維運者以 `docker save` 保存到 `backups/images/<imageRevision>.tar`。還原時把 `head.producer`、`head.schemaVersion` 與 `serving.schemaVersion`（lineage 的 canonical schema 版本，不是 `release.json` 的公開快照 schema 版本）寫回 `state.json` 與 `kind: restore` 事件；`servingExporter` 與 `serving.installId` 則取自 R-DATA-52 第 2 步實際採用的成品的安裝紀錄，未重用目的主機既有目錄時即為備份記載的 exporter。之後的 R-OPS-05 依它判斷 exporter 是否相同。
- **R-DATA-51：保留與異地範圍**
  - 異地同步必須涵蓋整個 `backups/`。
  - 物件 GC 只能刪除不被任何保留中的備份集、release、lineage 或 attempt 引用的物件。
- **R-DATA-52：`backup restore <set>`**
  1. 取得 writer lock，在 `scheduler.sqlite` 設定 `restore` 暫停原因（R-DEP-22），並登記本次 restore 的 `runId` 與來源備份集識別，狀態為「待提交」。scheduler 的資料庫不在還原範圍內；乾淨主機上它是 `init` 建立的空資料庫。
     - 冪等重跑：開始前先依 R-ARCH-04 對帳。若 `lastCommit` 是同一個備份集登記過的 restore 提交，代表上次已經在第 5 步 rename 之後中斷：不再發起第二筆提交，直接續完第 6、7 步。
  2. 在 staging 準備完整的還原內容：
     - 先把 `state/lseq` 提高到 `max(目前的 state/lseq, manifest 的 maxLseq)`，依 R-ARCH-03 耐久落盤，再為 head 與 serving 的 lineage 各配置新的 `lseq`（兩者相同時只配置一個）。因此在乾淨主機上，還原後的序號也一定大於原主機配置過的所有序號，不會與快照中的歷史序號重複。
     - 用 `putImmutable` 重建物件的邏輯 key 與 metadata。
     - 準備 release 目錄：依 R-ARCH-02／03 判斷。目的主機既有的同名目錄具有重用資格且 checksum 相符時，重用它，`serving.installId` 與 `servingExporter` 取自該目錄的安裝紀錄；否則安裝備份中的副本：配置新的 `installId`，`install.json` 的 exporter 保留備份記載的值。因此已被 prune 的 release 從備份重新安裝時，在提交前中斷後重跑，前一次未提交的安裝不會因舊事件引用同一個 `releaseId` 而取得重用資格，而是依 R-ARCH-03 視為 orphan。
  3. 合併 public ID 擁有權：目前主機 head 的 `*_public_ids` 與既有 reservation 中，凡是備份裡沒有的綁定，都寫入還原後 head lineage 的 reservation 表（R-DATA-16）。因此連續多次回溯還原時，先前留下、尚未認領的 reservation 也會繼承。完全相同的綁定合併為一筆。依 R-DATA-16 的雙向唯一檢查：同一個 key 綁定到不同 UUID，或同一個 UUID 綁定到不同 key，都在提交前拒絕還原、告警，並把雙方的綁定清單存為證據。
  4. 對 staging 做全量驗證（在第 3 步之後執行）：checksum、每個 lineage 的 `integrity_check` 與 `foreign_key_check`、所有引用物件，以及從 serving lineage 以 manifest 的 `basePath` 重新匯出後的 `snapshotId` 一致性。
  5. 以 `state.json` 的 rename 提交，同時更新 head 與 serving，並在 commit log 記錄 `kind: restore`。兩種情況都只追加一筆事件，沿用 R-ARCH-03 的一般提交協定與 R-ARCH-04 的對帳，不需要特別的安裝流程：
     - 目的主機已有 commit log（回溯還原）：保留既有 log，restore 事件的 `commitSeq` 為「目前最後一筆加 1」。
     - 目的主機的 log 是空的（乾淨主機）：新主機開始一份新的 log，restore 事件就是 `commitSeq=1` 的第一筆。備份的 commit log 快照原樣複製到 `backups/restored-from-<set>/` 作為證據，不寫入 `state/commit-log.jsonl`，因為它引用的歷史 release 與 lineage 不在備份中。
     - 新的 `state.json.commitSeq` 一律等於這筆 restore 事件的 `commitSeq`。
  6. 提交後步驟分成兩段：
     - 備份（R-DATA-50）在 restore 指令內執行。
     - 對外驗證（R-OPS-07）需要 web 已在提供服務，所以 restore 只在 `scheduler.sqlite` 記錄「待驗證的 restore 提交」，不在指令內執行。乾淨主機上，這一步會在 `up` 之後才發生。
     - 「待驗證」的登記與第 1 步的登記是同一筆紀錄，在第 5 步 rename 之前就已存在，所以 rename 之後任何時點中斷都找得到它。
     - `up` 之後，worker 在 `restore` 暫停期間仍會處理這筆紀錄：先以非阻塞方式取得 writer lock 並依 R-ARCH-04 對帳（補齊 log、備份與封存），再執行對外驗證；不啟動 run、不做清理。R-OPS-07 通過且備份成功後，自動解除 `restore` 暫停原因，排程恢復。
     - 只有對帳確認登記的 restore 已提交（`lastCommit.runId` 相符）時，才執行 R-OPS-07 並在通過後解除 `restore`。若對帳把它判定為 `abandoned`（rename 之前就中斷），不對既有 release 執行驗證，保留 `restore` 暫停並告警。
     - 任一步失敗時保留暫停並告警，由維運者處理後以 `schedule resume --reason restore` 解除。
     - restore 閘門：只要 `scheduler.sqlite` 中有狀態為「待提交」或「待驗證」的 restore 紀錄，其他取得 writer lock 的指令（`run *`、`migrate`、`release promote|rollback|rebuild --promote|prune`、`attempt prune`、`backup create`）都在取得 writer lock 後、對帳之前以 `status: restore_pending` 結束並回傳非零 exit code，不改變任何狀態。因此兩段之間 `lastCommit.runId` 不會被其他提交取代。允許的動作只有：worker 處理這筆紀錄、以同一個備份集重跑 `backup restore`（續做），以及唯讀指令。
     - 結束舊紀錄只能透過明確的取代流程：`schedule resume --reason restore` 把紀錄標為 `superseded`，並記錄維運者、時間與原因，之後閘門解除；以不同的備份集執行 `backup restore`，會先把舊紀錄標為 `superseded`，再登記新的 restore。被取代的 restore 不再自動驗證，需要時由維運者手動執行 R-OPS-07。
  7. 提交之後，才把被取代的 state 快照移到 `backups/pre-restore-<ts>/`，乾淨主機則複製第 5 步所述的 `backups/restored-from-<set>/` 證據。舊的 lineage 與物件不刪除。
  - 任一步驟在提交前中斷，原狀態都完整保留。
- **R-DATA-53：還原演練**：分成兩種情境，兩者都要做。
  - **乾淨主機災難還原**：在只有異地副本的乾淨主機上，執行 `init` → `backup restore` → `up`，重現相同的 `snapshotId` 與 serving release。備份集要選 `head ≠ serving.lseq`，且 head 與 serving 由不同 image 產生的狀態，還原後完成重啟、`release rebuild --verify` 與再同步一次。另外在步驟 2、4、5 各中斷一次後重跑；第 5 步要分別演練 rename 之前與之後中斷，以及 rename 之後中斷時「直接 `up`」與「重跑同一個 `backup restore`」兩種恢復方式。還原後 commit log 從 1 開始、只有一筆 restore 事件；新配置的 `lseq` 大於備份的 `maxLseq`；`up` 之後 R-OPS-07 通過、排程自動恢復；`release rollback` 只列出備份中的 serving release，不引用不存在的歷史成品。
  - **回溯還原**：在 head 比備份新的主機上還原較舊的備份，再同步一次。驗收：reservation 寫入後 FK 仍成立；同名的新主體不能取得被保留的 key；原主體重新出現後取回相同的 key，更名後也一樣；連續兩次回溯還原後，第一次留下的 reservation 仍有效。還原前已有 `attempt_quota` 暫停時，restore 期間不清理 attempt；`restore` 解除後的下一次 tick 才清理並重評，必要時解除 `attempt_quota`，期間不啟動 run。
  - **restore 閘門**：在 restore 指令結束、worker 完成驗證之前，手動執行 `migrate`、`run current` 與 `release promote`，三者都以 `restore_pending` 拒絕，`state.json` 與 commit log 不變；以同一個備份集重跑 `backup restore` 可續做；`schedule resume --reason restore` 之後紀錄標為 `superseded`，`migrate` 才能執行。

## 8. 前端需求（UI 重設計）

### 8.1 必須保留的使用者契約

重設計可以改寫測試的 selector，但不得刪除下列行為斷言。

| 契約 | 現有證據 |
| --- | --- |
| URL 狀態參數 `leftKind/leftId/leftEraId/rightKind/rightId/rightEraId/from/to/events/leagues/bestOf` 的名稱與語意不變。legacy UUID 連結要 canonicalize 為 readable 形式，並保留篩選；未知的 readable ID 留在 URL 上，並顯示復原提示；無效的狀態以 canonical 預設取代 | `app.test.tsx` 中的 route 案例 |
| 預設比較：T1 vs LPL、2019-01-01–2026-12-31、Worlds、BO5 | `defaultRouteState`、`test/default-comparison.test.ts` |
| 保存、載入、刪除比較：localStorage key 為 `riftversus.saved-comparisons`，格式為 version 2，最多 20 筆。行為變更：已滿 20 筆時不再靜默裁切最舊的一筆（R-WEB-11） | `storage.ts`、`storage.test.ts` |
| PNG 與多頁 ZIP 匯出：每頁都要有可解碼的可見像素；分頁不重排；不混用不同 release 或不同篩選的資料；最多 1000 列；BO2 平手不算敗場；標示單局資料不完整；圖片載入失敗時改用 placeholder | `export-result.test.ts`、`ExportButton.test.tsx`、E2E |
| player 顯示為 `ID (真名)`；比較列顯示歷史隊名與 team-era 標籤；摘要保留選定的主體 | `app.test.tsx` |
| coverage warning、`單局明細不完整` 標示、BO2 的 `DRAW` | 同上 |
| Combobox ARIA 與鍵盤操作：方向鍵、Enter、Escape、blur 時還原；沒有選項時按 Enter 不送出 | `app.test.tsx` |
| 圖片來源與權利聲明頁 | `presentation/image-credits.html` |
| cursor 分頁，每頁 50 列 | `app.test.tsx` |
| 手機寬度下沒有水平捲動 | E2E mobile |

勝率定義沿用 domain：`winRate = wins / total`，`total` 包含 draws。

計數範圍沿用 domain：

- `seriesSummary`：用系列賽比分計算，可能包含 awarded starts。
- `gameSummary`：player 比較時，只計入「雙方直接交手且有勝方」的單局；非 player 比較時，依現行實作計算。

### 8.2 設計方向

- **主題概念：「轉播計分板」**
  - 比較雙方各有固定的側色，貫穿總覽、賽果與圖表：左方藍 `--side-a`，右方紅 `--side-b`。
  - 數字一律使用 tabular numerals。
- **字型**
  - UI 使用 `Noto Sans TC`，比分使用 `Barlow Condensed`。兩者皆為 OFL 授權，以 `woff2` 自行託管。
  - CJK 字型需子集化，以 `unicode-range` 分片並設定 `font-display: swap`。首屏字型總量 ≤ 400 KB。
- **Design tokens**：用 `:root` 的 CSS custom properties 定義，涵蓋色彩、4px 基準的間距、圓角、陰影與字級。
  - 色彩包括：背景、表面、文字、muted、線條、accent、side-a、side-b、win、loss、draw、warning。
- **主題切換**
  - 預設跟隨 `prefers-color-scheme`；使用者可手動選擇亮、暗或系統，偏好存在 localStorage。
  - 兩個主題都要達到 WCAG 2.2 AA。側色要能和 win／loss 色區分，並另外提供文字或圖示，不只靠顏色辨識。
- **實作限制**
  - 樣式用純 CSS，依元件拆檔，不引入 UI framework 或 CSS-in-JS。
  - 圖示沿用 `lucide-react`，圖表以手寫 SVG 實作。

### 8.3 資訊架構與互動

1. **Top bar**
   - wordmark。
   - 資料狀態膠囊：顯示快照日期與涵蓋範圍；點開後可看 `releaseId`、`snapshotId` 與最後同步時間。
   - 保存清單入口、主題切換。
2. **對戰舞台**
   - 左右各一張主體卡：大頭像或隊標、名稱、真名、類型、era 標籤，並內嵌搜尋 combobox。
   - 兩張卡中間是交換按鈕。主體選定後立即套用。
3. **篩選列**
   - 項目：日期快速選項（全部、近 1 年、近 3 年、自訂）、賽事類型、聯賽、賽制。
   - 寬度 ≥ 768px 時為單列，可換行。
   - 寬度 < 768px 時收進 bottom sheet，並顯示目前啟用的篩選數。sheet 的焦點行為：
     - 開啟時焦點鎖在 sheet 內，Tab／Shift+Tab 在 sheet 內循環。
     - 以 Escape、點背景或按「完成」關閉；關閉後焦點回到開啟按鈕。
   - **行為變更**：篩選改為立即套用，移除「套用篩選」按鈕與 draft 狀態。瀏覽紀錄規則：
     - chip 切換：500ms debounce 內合併成一次 `pushState`。
     - 等待提交期間：
       - app 內的動作（切換主體、交換、保存、匯出）先立即提交待提交的變更，再執行該動作；保存與匯出取用的一律是使用者當下選定的條件。
       - 瀏覽器原生的 Back／Forward（`popstate`）則取消尚未寫入歷史的提交，直接套用 popstate 的狀態，不補做 `pushState`，以免改寫 Forward 歷史。
     - 日期輸入：在 blur 或 Enter 時提交。
     - 交換與主體變更：各自產生一筆紀錄。
     - canonicalize：用 `replaceState`。
     - Back／Forward：完整還原狀態。
   - 日期區間無效時以 inline 方式提示，不套用，也不 push。
4. **總覽計分板**
   - 顯示 series W–L（有平手時加 D）、game W–L、雙方側色分割的勝率條。
   - 顯示最近 5 場系列賽戰績（W／L／D，附文字）。
5. **統計拆解**：依年份、依賽事類型呈現的 SVG 長條圖，資料來源為 breakdown API（§8.4）。
6. **賽果清單**
   - 依年份分組，年份標題 sticky。每列顯示日期、賽事、BO、雙方當時的隊名、比分與結果徽章。
   - **新增功能**：可展開單局明細，語意見 §8.4。
     - 兩個 player 沒有直接交手的單局以灰階顯示，標示「未直接交手」，不計入 game 數。
     - 比分中的 awarded starts，或缺漏的單局，標示「無單局資料」。
   - 分頁：
     - 提供「載入更多」按鈕，並以 IntersectionObserver 自動載入。
     - 自動載入可關閉；`prefers-reduced-motion` 時不自動載入。
     - 自動載入失敗時保留手動按鈕。
7. **匯出**：入口在總覽區。匯出 sheet 重新設計，但保留 1200px 寬度、分頁規則與 gate。
8. **保存清單**
   - 桌面為右側 drawer，手機為全螢幕 sheet，焦點規則同第 3 項。
   - 每筆顯示雙方、篩選摘要與日期，並提供 JSON 匯出與匯入（§8.6）。
9. **狀態畫面**
   - 載入中：skeleton。
   - 錯誤：提供重試。
   - 未知主體：引導重新選擇。
   - 無結果：提供「清除篩選」。
10. **Footer**：Leaguepedia 來源與授權、圖片權利聲明、`releaseId`、image revision。

斷點：

| 寬度 | 版面 |
| --- | --- |
| ≥ 1200px | 三欄對戰舞台 |
| 768–1199px | 縮小主體卡 |
| < 768px | 主體卡堆疊、篩選收進 bottom sheet、賽果列改為兩行 |

最小支援寬度為 320px。

### 8.4 API（`/api/v1`）與 release identity

所有回應都以 `packages/contracts` 的 zod schema 在 server 端與 client 端各驗證一次。錯誤格式為 `{ error: { code, message } }`。

- **R-API-01：release 釘選**
  - client 啟動時呼叫 `GET /api/v1/meta` 取得 `releaseId`。之後每個資料請求都帶 `release=<releaseId>`，TanStack Query 的 query key 也都包含 `releaseId`。
  - server 提供 serving release，以及依 commit log 推導、仍在 24 小時保留期內的 release，兩者都以唯讀連線池開啟。保留範圍在重啟後依 commit log 重建，並與 R-DATA-22 的 GC 規則一致。
  - 保留視圖與 serving 必須來自同一個 `commitSeq`：web 讀到的 `state.json` 若比 commit log 新一筆（log 尚未補齊），就比較 log 最後一筆合法事件的 `serving.releaseId` 與 `state.json` 的 `serving.releaseId`：
    - 兩者不同：視為在 `lastCommit.at` 發生一次 serving 切換，把 log 最後一筆的 serving release 視為剛卸任、仍在保留期內。
    - 兩者相同（例如只推進 head 的 `migrate`）：沒有新的卸任，保留視圖與 log 補齊後的結果相同。
    - web 只讀，不修復 log。
  - 錯誤碼：
    - 請求的 release 已超過保留範圍：回 `410 release_expired`。client 顯示「資料已更新」並提供重新載入；進行中的匯出整份中止。
    - cursor 無效：回 `400 invalid_cursor`。
  - 匯出的 release 檢查：媒體 URL 不帶 release，載圖本身無法察覺 release 到期。因此在 PNG 編碼與 ZIP 壓縮都完成、最終成品就緒之後，觸發下載之前，呼叫 `GET /api/v1/releases/:releaseId` 確認仍在保留期內：
    - 回 `410`：整份匯出中止，丟棄成品，不觸發下載。
    - 個別圖片載入失敗：沿用現行行為，改用 placeholder 並繼續。兩種結果分開呈現。
- **R-API-02：API cursor**
  - API 不直接傳 domain cursor，而是包成 `base64url({ v, releaseId, queryHash, domainCursor })`。其中 `queryHash` 是正規化後查詢的 sha256。
  - server 驗證 `releaseId` 與 `queryHash` 都相符，才把 `domainCursor` 交給 domain。因此，即使兩個 release 的 `snapshotId` 相同，也不能互用 cursor。
- **R-API-03：媒體**
  - 媒體以內容定址，從共用的 `media/` 池以 `/presentation/<sha256>.<ext>` 提供，標頭為 `immutable`。只要任何保留中的 release 還引用它，就不會被刪除。
  - credits 頁以 `/presentation/image-credits.html?release=<releaseId>` 提供，回傳該 release 的版本，設 `immutable`；release 已過保留期時回 `410`。
  - 不帶 `release` 參數時，回傳目前 serving release 的版本，設 `no-cache`。
  - `/presentation/credits.css` 是 image 內的靜態資產，與 release 無關。

| Method／Path | 回應 | 備註 |
| --- | --- | --- |
| `GET /api/v1/meta` | `{ releaseId, snapshotId, schemaVersion, dataset, coverage, lastSuccessfulSyncAt, imageRevision }` | `no-cache` |
| `GET /api/v1/releases/:releaseId` | `{ releaseId, available: true }` | 超過保留期回 `410 release_expired`；`no-cache` |
| `GET /api/v1/entities?release=&q=&kinds=` | `ResolvedSubject[]`，最多 20 筆 | `q` 長度 1–64；每個來源 IP 每 10 秒最多 30 次，來源 IP 依 `TRUSTED_PROXY_HOPS` 判定（R-DEP-12） |
| `GET /api/v1/subjects/resolve?release=&kind=&id=&eraId=` | `ResolvedSubject` | 找不到時回 `404 unknown_subject` |
| `GET /api/v1/comparison?release=&<route query>&cursor=` | `ComparisonResponse` 分頁 | cursor 格式依 R-API-02 |
| `GET /api/v1/series/:seriesId/games?release=&<route query>` | 見下方 | 單局明細；系列賽不存在或不在該查詢的結果中時回 `404 unknown_series` |
| `GET /api/v1/comparison/breakdown?release=&<route query>` | 見下方 | 對完整篩選集合計算，不受分頁影響 |
| `GET /healthz` | 行程存活 | 不存取資料 |
| `GET /readyz` | serving release 已載入、schema 受支援、`basePath` 相符 | — |

單局明細的回應結構：

```text
{ seriesId, complete: boolean, missingGames: number,
  games: [{ id, order, playedAt,
            matchup: "direct" | "indirect", sideBasis: "game" | "series",
            winner: "left" | "right" | null,
            left:  { teamName, eraLabel: string | null, players?: PlayerRef[] },
            right: { … } }] }
PlayerRef = { id, publicId?, displayName, realName? }
```

- 回傳該系列賽的所有單局，依 `game_number`、`id` 排序（不依時間，兩者順序可能不同）；`order` 即 `game_number`。
- left／right 的判定沿用 domain 查詢，不在 API 層另行推導，並依比較類型分成兩種，與 §8.1 的 `gameSummary` 計數範圍對齊：
  - **非 player 比較**（雙方都不是 player）：`gameSummary` 用系列方位與比分計算，所以每一局都使用系列方位 `series_left_team_id`，`sideBasis: "series"`，`matchup` 一律為 `direct`。驗收：系列完整時，各局 `winner` 加總等於該系列的比分。
  - **含 player 的比較**：
    - `direct` 單局：使用該局在 domain `direct_games` 中的 `left_team_id`，`sideBasis: "game"`。這與 player 比較的 `gameSummary` 計數完全一致，同一局的明細勝負與摘要不會相反。
    - `indirect` 單局：沒有可用的單局方位，改用系列方位 `oriented_matches.left_team_id`，`sideBasis: "series"`。`left.kind === "player"` 時取 domain 的 `fd.left_team_id`（第一個直接交手單局中左方選手的隊伍）；`left.kind !== "player"` 時取 `series_left_team_id`。
  - UI 依 `sideBasis` 所示的方位放置隊伍與側色。`winner` 依該局的 left／right 標示，因此左方選手缺席的單局，也有確定的 left／right 與 `winner`。
- `matchup`（只在含 player 的比較中有差別）：
  - `direct`：符合 domain 的直接交手判定（與 `gameSummary` 共用同一個判定），也就是比較雙方在該局分屬兩隊。
  - `indirect`：其他所有情況，包括任一方未出場（替補、缺席）、兩名選手同隊，以及 player 與所選 team／region 在同一側。
  - `indirect` 的單局不計入 player 比較的 `gameSummary`。
- 驗收 fixture 使用 `packages/domain/test/sqlite-query.test.ts`，同一份資料跑兩種查詢：
  - LCK（region）對 Xiaohu（player）：`direct` 單局的勝負必須與 `gameSummary` 一致。
  - LCK 對 LPL：每一局依系列方位，與該系列的比分及 `gameSummary` 一致。
- `players` 只在至少一方是 player 時提供，依 `displayName` 排序。
- `missingGames` 等於比分總局數減去有資料的局數，awarded starts 也算在內；只要大於 0，`complete=false`。不推測、不補值。

breakdown 的回應結構：

```text
{ byYear: [{ year, series: Record, games: Record }],
  byEvent: [{ category, series, games }],
  recentForm: [{ seriesId, date, result: "W" | "L" | "D" }] }
```

- `Record` 與 `seriesSummary`／`gameSummary` 同型，計數範圍也沿用 §8.1 的定義。
- `year` 取 series `date` 的 UTC 年份。
- `recentForm` 依 `playedAt` 由新到舊取前 5 筆，以左方視角判定勝負。
- 不變式：各年份加總必須等於 `seriesSummary` 與 `gameSummary`，各賽事類型的加總亦同。

- **R-API-04：只讀**：API 只讀取已發布的 release，不得呼叫 Leaguepedia 或任何上游服務。
- **R-API-05：路徑與安全標頭**
  - `/assets/*`：帶 hash，設 `immutable, max-age=31536000`。
  - `/presentation/*`：通過 safe-path 驗證，禁止跳脫與 symlink。
  - 其他 GET：SPA fallback 回傳 `index.html`，設 `no-cache`。
  - CSP：`default-src 'self'; img-src 'self' data: blob:; style-src 'self'`。
  - 另外設定 `X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`。
  - 不開放 CORS。
- **R-API-06：熱切換**
  - web 以 `fs.watch` 加輪詢監看 `state.json`。
  - 新 release 必須通過 schema 與 `basePath` 檢查後才切換；舊 release 在保留期內仍然可用。
  - 切換失敗時保留原本的 serving，並由 `/readyz` 回報。
- **R-API-07：效能**
  - server 端：以 cutover 時的完整資料量（約 7k series 以上）、熱快取、20 個並發量測，預設比較、搜尋、單局明細與 breakdown 的 p95 ≤ 150 ms。
  - 前端：首頁初始 JS ≤ 180 KB（gzip）。
  - 冷啟動：Playwright 在 4G throttling 下，從開啟頁面到顯示預設結果 ≤ 2.5 秒。

### 8.5 Web runtime

- **R-WEB-01**
  - `ComparisonApi` 新增 `meta()`、`releaseStatus()`、`seriesGames()`、`breakdown()`。
  - Docker image 使用 `http-runtime`；`mock-runtime` 同步實作這些方法。
  - P2–P4 期間 `apps/web` 有兩個 build 入口，共用同一套 UI 元件：
    - `build:pages`：沿用 `static-runtime`（`sql.js-httpvfs`），供 `publish.yml` 與現有的 static E2E 使用。新查詢由 domain 擁有，static runtime 在瀏覽器中執行同一組 domain 查詢；`releaseStatus()` 在靜態站恆為可用。
    - `build:docker`：`http-runtime`，供 production image 與容器 E2E 使用。
  - P5 移除 `build:pages`、`static-runtime`、`snapshot-client` 與 `sql.js-httpvfs`。
- **R-WEB-02**：`lang="zh-Hant"`，UI 字串集中管理。
- **R-WEB-03**：支援 `prefers-reduced-motion`；所有操作都能用鍵盤完成，且有可見的焦點樣式。

### 8.6 舊 origin 遷移（D6）

- **R-WEB-10：Pages 遷移頁**
  - 發布在舊 origin 原本的專案路徑（`/RiftVersus/`），經 D6 的 `gh-pages` 分支發布。因為與舊站同 origin，可以讀到使用者原本的 localStorage。
  - 深層路徑由 Pages 的 `404.html` 承接，保留 path 與 query。導向目標為新 origin 的 `${PUBLIC_BASE_PATH}` 加上移除 `/RiftVersus/` 前綴後的剩餘路徑，目的前綴可以是 `/` 或巢狀前綴。
  - 讀取舊 origin 的 `riftversus.saved-comparisons`（version 2）。
  - 編碼後 ≤ 32 KB：以 base64url 放進 `#import-saved=`，連同原本的 path 與 query 一起導向新 origin。
  - 超過 32 KB：不自動轉移，改為顯示 JSON 下載與前往新站的連結。
  - JSON 下載按鈕永遠可用。
  - 遷移頁至少保留 12 個月。
- **R-WEB-11：新 app 匯入**
  - 驗證：以 `storage.ts` 的規則驗證 schema。
  - 確認：顯示「匯入 N 筆」的確認提示。
  - 合併規則：
    - 以 `id` 去重。同一個 `id` 但內容不同時，保留本機現有的那筆，並顯示衝突的數量。
    - 合併後若超過 20 筆，列出全部項目讓使用者勾選要保留哪些（預設保留 `createdAt` 最新的 20 筆）。確認後一次寫入。
  - 寫入失敗（例如超過 quota）時不改動任何資料，並顯示錯誤。
  - 重複匯入同一份資料，結果不變。
  - 匯入完成後清除 fragment；拒絕或驗證失敗時不寫入。
  - 保存已滿：已有 20 筆時再保存，要求使用者選擇替換哪一筆，或取消；不得靜默裁切（取代現行 `storage.ts` 直接丟棄最末一筆的行為）。
  - 驗收：
    - 匯入後保存新的比較時，使用者勾選保留的項目不會被靜默移除。
    - 滿 20 筆時確認替換：只有使用者選定的那一筆被新比較取代，其餘 19 筆不變。
    - 滿 20 筆時取消，或寫入失敗：原本的 20 筆完整保留。

## 9. 測試與驗收

### 9.1 測試調整

- **Integration suite**
  - 依賴 PG 的 integration suite，要建立對應的 SQLite 版本：每個測試使用一個暫存 DB 檔。
  - P5 之前，PG 版本仍保留在 CI 中，作為舊發布路徑的回歸測試（D1）。
- **差異 oracle**
  - P1 時以 PG 路徑對 synthetic 與代表性 fixture 產生 golden 輸出，並凍結提交。輸出包括 projection、comparison 回應與 acceptance 結果。
  - SQLite 路徑必須持續產生相同的輸出，P5 之後這組 golden 仍然可以重跑。
- **Legacy parity**：在 CI 的 legacy job 中執行，P5 移除。
- **E2E**：以 Playwright 對 `docker run` 起來的 production image 執行，使用 synthetic fixture release。涵蓋項目：
  - 基本流程：預設比較、分享連結、player 身分搜尋、PNG／ZIP 匯出。
  - 版面：320／767／768／1199／1200px 斷點兩側；雙主題的 axe-core AA 檢查。
  - 互動：sheet 與 drawer 的開關、焦點循環與歸還；Back／Forward；debounce 期間觸發原生 Back／Forward、主體切換、保存與匯出，以及畫面結果尚未更新時的保存與匯出；錯誤重試；reduced-motion 下的手動載入。
  - 單局明細：跨頁、BO2、awarded score，以及左方選手缺席、兩名選手同隊、player 與 team／region 混合、`game_number` 與時間順序不同的 fixture。breakdown 與 `seriesSummary`／`gameSummary` 分別比對。
  - release 切換：在 resolve 與分頁之間切換、匯出途中切換；最後一頁已取完、媒體仍可讀取，但原 release 在 PNG 編碼或 ZIP 壓縮期間到期時，匯出在觸發下載前中止（與個別圖片退回 placeholder 分開驗證）；相同 `snapshotId` 但不同 release 的 cursor；多次切換後重啟。
  - `PUBLIC_BASE_PATH` 分別設為 `/`、`/RiftVersus/`、`/RiftVersus/new/`。
  - credits 在 CSP 下正確渲染。
  - 保存比較匯入：以真實的舊 origin 驗收 localStorage 轉移、根路徑與巢狀目的前綴、既有 query；version 2、超過 32 KB、超過 20 筆、同 id 衝突、拒絕匯入、重複匯入、quota 失敗；已滿 20 筆時的保存。
- **移除**：HTTPVFS 專屬測試，以及 `scripts/static-network-profile*`。
- **新增 server 與 worker 測試**
  - server 基本行為：safe-path、安全標頭、rate limit、308 導向（含巢狀前綴與防迴圈）、熱切換時不中斷進行中的請求。
  - 鎖與排程：跨容器撞鎖、pending 合併、補跑、`schedule tick` 在內建排程與主機 timer 兩種路徑的行為一致。
  - 逾時與提交：逾時、每個 rename／fsync 邊界的故障注入（含新物件的 fsync），以及對帳（含 `commit_uncertain`）；abandoned candidate 不得 promote。
  - commit log：`state.json` 已切換、commit log 尚未落盤時硬終止；log 最後一行只寫入一半；只切換 serving 的提交在 rename 後被終止；手動指令被終止後由常駐 worker 接手下一次寫入。對帳後 log 都是完整連續的序列，並補齊事件與提交後步驟；在 log 補齊之前，web 仍讓剛卸任的 release 可以分頁。只推進 head 的 `migrate` 缺行時，log 補齊前後的保留視圖一致，已逾期的 `previousServing` 不會被誤判為仍可用。
  - orphan release：release 目錄已落盤、`state.json` 尚未提交時中斷，再由另一個 image 接手並產生同一個 `releaseId`；orphan 被保留為證據，不被重用，`servingExporter` 是接手的 image。另一個案例：image A 匯出的 release 被 prune 刪除後，image B 以同一個 `releaseId` 重新匯出並在提交前中斷，再由 image C 接手；雖然舊事件仍引用該 `releaseId`，B 的目錄因 `installId` 未被引用而視為 orphan，`servingExporter` 是 C，不是 A 或 B。
  - lineage 來源：image B 的 `migrate` 只推進 head，之後由 image C 備份並在乾淨主機還原後再備份；`head.producer` 仍是 B，`servingExporter` 仍是原本的 exporter。
  - 物件耐久：run A 在物件 rename 後、目錄 fsync 前被終止，run B 重用該物件並提交；模擬斷電後，canonical 引用的物件全部存在且 checksum 相符。
  - release 重用：不同 lineage 產生同一個 `releaseId` 時，重用既有目錄；之後的 promote、重啟與 prune 都依 commit log 取得正確的 lineage。
  - rollback：rollback → 重啟 → 新 run promote，`lseq` 不碰撞，被跳過的 lineage 不會被清除；`state/lseq` 已遞增但 lineage 尚未改名時硬終止，序號不重用。
  - 遷移匯入：含 unchanged run（`reused_dataset_version_id`）的 fixture，兩向引用都保留，`foreign_key_check` 通過。
  - 同源後繼判定（R-DATA-46）：checkpoint 之後經授權只改 `played_at`、generation 不變的修正，以及 checkpoint 之後新增、再經授權修正的 fact，都以 audit 鏈證明為同源；audit 鏈斷裂、引用的來源不存在，或現值與最後一筆 `new_payload` 不符，都判為分岔。
  - attempt：超過 `ATTEMPT_MAX_BYTES` 後暫停、清理後自動恢復排程；多批 history 其中兩批失敗時，以 `attempt show --request` 只用 attempt 目錄與 `objects/` 離線重讀每一批及其審閱輸入。
  - 升級停寫：`schedule pause` 之後，內建排程與主機 timer 的 `schedule tick` 都完全 no-op，不取得 writer lock；升級途中 attempt 容量恢復時，`attempt_quota` 保留不變、tick 不清理；`schedule resume` 之後的下一次 tick 才重新評估並解除；升級全程沒有 sync 寫入。
  - 對帳途中再次斷電：在補寫 log 之後、任何後續步驟之前斷電，重啟後 state 與 log 仍一致，不觸發 fail closed。
  - exporter 身分：由 image A 匯出的 serving release，在乾淨主機以 image C 還原後再備份，`servingExporter` 仍是 A。目的主機已有 image B 匯出、具重用資格的同一 `releaseId` 時，還原事件與再次備份都記錄 B；沒有可重用的目錄時記錄 A。
  - 還原已被 prune 的 release：從備份重新安裝後、提交前中斷，再以同一個備份集重跑；前一次的目錄視為 orphan，新安裝取得新的 `installId`，最終只有一筆 restore 事件。
  - history：多批 history 部分失敗；目標 scope 的成功、fail-closed、硬終止，以及 `evidence_incomplete` 的 attempt。
  - 資料邊界：media-only 防護（含 `is_current` 切換、`sync_runs` 狀態轉換與無變更的 manifest 等合法案例）；attempt 不得被拿來還原；`init` 在空白 named volume 與無寫入權限的 bind mount 上的行為；R-OPS-10 的跨年、過期與缺 mapping 案例。
- **舊發布路徑回歸**：P1–P4 的每個 PR，都必須讓現有的 `pnpm test`、PG integration，以及以 `build:pages` 建置的 static E2E 照常通過（該測試禁止 `/api/` 請求，只適用於 Pages 入口）。容器 E2E 另外以 `build:docker` 執行。

### 9.2 Shadow run（P3，在目標主機上）

- **current**：使用 shadow volume，排程的 current 必須連續成功至少 7 次。每次都與同一天 Actions 產生的 checkpoint 比對同一批 scope 的 series 數與 game 數；若有差異，必須能以上游時間差解釋並記錄。
- **scope 一致性**：`plan show` 的有效 scope 必須與 Actions 的 vars 及 reviewed map 推導出的 scope 一致。
- **history**：在明定的 scope 範圍內，每個 scope 的成功或失敗結果必須與同一週 Actions 的結果一致。
  - fail-closed 的 scope 必須產生可重讀的 attempt，且失敗原因相同。
  - 若 cutover 必要的 scope 被真實上游阻擋，列為 cutover 阻塞，不得放寬 gate 來繞過。
- **重建與還原**：`release rebuild --verify` 結果一致，且 R-DATA-53 的還原演練通過。

### 9.3 Cutover 驗收

項目 1、2 必須在 R-DATA-46 第 5a 步之前成立；項目 3–6 在第 5a 步執行並通過後，才能進入第 5b 步。

1. §9.2 全部通過。
2. R-DATA-46 第 1–4 步完成，且 R-DATA-42、R-DATA-44 通過。
3. 對正式 origin 執行 desktop 與 mobile 的 release 版 E2E，包含 PNG／ZIP 的可見像素、credits 渲染與冷啟動預算。
4. web 與 worker 的 image ID 相同、以非 root 執行、rootfs 唯讀，資源用量符合 R-DEP-07，且 R-DEP-42 的相容演練通過。
5. 舊分享連結（legacy UUID、readable、`/RiftVersus/` 前綴）都能解析到正確的主體。
6. 以第一份 serving release 為對象，R-OPS-07 對外驗證通過。
7. 第 5b 步之後，第一次由新 writer 提交的結果也必須通過 R-OPS-07。之後另開 PR 刪除 `publish.yml`，並依 §10 讓其餘項目退場。

## 10. 退場清單（P5）

| 項目 | 處置 |
| --- | --- |
| `.github/workflows/publish.yml` | 刪除；`PUBLISH_ENABLED` 維持 `false` |
| `ci.yml` 的 PostgreSQL service、PG client、checkpoint DB、legacy job | 刪除；保留 docker build 與容器 E2E |
| `apps/data` 中的 `publish-run`、`publish-github`、`publish-plan`（年度 gate 移到 R-OPS-10）、`site-bundle`、`site-commands`、`archive-commands`、`release-store`、`checkpoint-release`、`checkpoint`（PG）、`postgres-checkpoint`、Release 版的 `attempt-archive` 與 `media-archive` | 刪除。`site-download` 與封存驗證能力暫留在 legacy 工具 image，直到 R-DEP-43 的期限屆滿 |
| `acceptance:archival` | P1 移植到 SQLite，以固定的 gen-4 checkpoint 驗收（R-DATA-43） |
| PG 差異測試（例如 `packages/database/test/snapshot.integration.test.ts`） | 由凍結的 golden fixture 取代後刪除 |
| `packages/database` 的 PG 實作、`pg`、`@types/pg`、PG migrations | 刪除；migrations 移到 `docs/archive/postgres-migrations/` |
| `Dockerfile` 的 `legacy-tools` target、compose 的 `legacy-import` profile | 在 R-DEP-43 的期限屆滿後刪除 |
| `apps/web` 的 `build:pages`、`static-runtime`、`snapshot-client`、`sql.js-httpvfs`，以及 static E2E | 刪除；release E2E 的 `RIFTVERSUS_E2E_BASE_URL` 改指向新 origin |
| `scripts/measure-static-sqlite.mjs`、`verify-hosted-workflows.mjs`、`static-network-profile*` | 刪除。`build-static-fixture.mjs` 若仍用於 E2E fixture，改寫後保留 |
| `test/github-publish.test.ts`、`test/github-ci.test.ts` | 改寫為驗證新的 `ci.yml`、Dockerfile 與 compose 約束 |
| compose 的 `postgres`、`minio` profile | 刪除；named volume 不刪 |
| `docs/github-publishing.md`、`github-pages-actions-proposal.md`、`checkpoints.md`、`site-archives.md` | 移到 `docs/archive/` 作為歷史紀錄；改寫 `README.md`、`deployment.md`、`operations.md`、`sqlite-development.md` |
| 私有 `RiftVersus-data` 的 Releases、舊 volume、備份 | 保留 |
| ADR 與 baseline | P1 新增 ADR-0002；P5 完成後建立新的 baseline |

## 11. 分階段計畫

每個 phase 是一個獨立的 PR，前一個 phase 通過後才開始下一個。P5 之前，生產環境仍由 `publish.yml` 與 Pages 提供，任何 phase 都不得破壞舊的發布路徑（§9.1）。

| Phase | 內容 | 生產影響 |
| --- | --- | --- |
| P0 | 本規格（純文件） | 無 |
| P1 | SQLite canonical（與 PG 並存）：<ul><li>選定驅動、baseline migration、§7.3 寫入保證</li><li>SQLite repositories、gate 與拒絕測試</li><li>golden oracle、archival acceptance 移植</li><li>legacy 工具 image 與 parity</li><li>ADR-0002</li></ul> | 無 |
| P2 | <ul><li>`apps/server`、API、release 模型與 lineage／state 機制</li><li>`http-runtime`（暫時沿用舊 UI）</li><li>production Dockerfile、compose、runtime base path</li><li>CI 加入 docker build 與容器 E2E</li></ul> | 無 |
| P3 | <ul><li>worker、`schedule tick`、鎖與對帳</li><li>attempt、告警、備份、`run media --pack`、`plan show`</li><li>在目標主機用 shadow volume 跑 §9.2</li></ul> | 無（與 Pages 並行） |
| P4 | 前端重設計、單局明細與 breakdown UI、保存比較的匯入與匯出（可與 P3 並行） | 無 |
| P5 | <ul><li>依 R-DATA-46 與 §9.3 執行 cutover</li><li>部署 Pages 遷移頁</li><li>依 §10 退場</li><li>更新文件與 baseline</li></ul> | 生產切換 |

## 12. 風險與緩解

| 風險 | 緩解 |
| --- | --- |
| 單一主機故障或磁碟損毀 | 可獨立還原的備份集加上異地保存（D4、R-DATA-51），並以乾淨主機演練還原（R-DATA-53） |
| 增量寫入長期累積造成漂移 | candidate 隔離（R-ARCH-01）、每週重建驗證（R-OPS-05）、`integrity_check` |
| 未驗收的寫入污染 canonical | 寫入只發生在 candidate，唯一的 commit 點，以及三態對帳（R-ARCH-03、R-ARCH-04） |
| rollback 造成寫入歷史倒退，或 public ID 被搶 | head 與 serving 分開（R-DEP-40）、單調遞增的 `lseq`、還原時保留 public ID（R-DATA-52） |
| `node:sqlite` 仍為 experimental | 鎖定 Node 小版本；P1 依證據選定驅動；以 adapter 隔離 |
| SQLite trigger 的授權語意比 PG 弱 | §7.3 的等價設計，並移植與新增拒絕測試 |
| 非 ASCII 搜尋的行為改變 | fold 欄位，並加入多語系測試 |
| 遷移期間資料分歧或遺失 | 交接順序（R-DATA-46）、本機資料封存與逐列比對、物件對帳、嚴格 parity |
| 換 origin 造成保存資料與分享連結失效 | 遷移頁、fragment 轉移、JSON 下載與匯入、308 導向 |
| 生產環境不再每次截圖 | 瀏覽器 E2E 跟隨 image 版本執行，commit 後另做對外驗證（R-OPS-07） |
| 常駐排程無聲失效 | worker healthcheck、webhook 告警，並在 `meta` 公開最後同步時間 |
| release 切換造成資料不一致 | release 釘選、API cursor 綁定 release、24 小時保留期（R-API-01、R-API-02） |
| 正式排程的 scope 設定錯誤 | 由 repo mapping 產生排程計畫、延續年度 gate，並在 shadow run 比對 scope（R-OPS-10、§9.2） |

## 13. Governance 7 維度審查

| 維度 | 評估 |
| --- | --- |
| Ownership integrity | <ul><li>facts：Leaguepedia</li><li>canonical 寫入：worker（writer lock 加上唯一的 commit 點）</li><li>排程狀態：scheduler 模組</li><li>查詢語意：`@riftversus/domain`</li><li>公開讀取：web（只讀不可變的 release）</li><li>備份：`backup` 指令</li><li>媒體資格：sync 與 `run media --pack` 的 gate</li><li>正式 scope：repo mapping</li></ul>每一項都只有一個 owner。 |
| Module boundaries | web 只依賴 contracts、domain 的型別與 API；server 依賴 domain 查詢，不 import `packages/sync`；只有 worker 使用 sync 與 database。 |
| Contract changes | <ul><li>新增：`/api/v1`、release identity 與 API cursor、`410`／`400`、單局明細與 breakdown、保存比較的匯入</li><li>行為變更：篩選改為立即套用、base path 預設 `/`、rollback 拆成三條路徑、pending 改為每種 kind 一筆（D10）、保存已滿時改為明確選擇</li><li>不變：URL 參數、schema v3、快照內的媒體 URL 格式</li></ul>以上皆由 ADR-0002 記錄。 |
| Cascade proliferation | 移除 PG、Release 封存協定、Pages、HTTPVFS 四條外部依賴鏈。新增的依賴只有 HTTP 框架與排程函式庫（P2／P3 選定）。 |
| Dependency direction | apps 依賴 packages，contracts 最穩定，domain 不依賴 database。 |
| Retirement completeness | §10 逐項列出退場項目，並綁定 P5 與 R-DEP-43 的期限；PG 只保留在 legacy 工具 image 中；差異 oracle 與 archival acceptance 都有替代方案。 |
| Entropy flow | 淨減少：一種資料庫引擎、一個查詢執行位置，不再需要 Release 封存協定與 Range 傳輸。新增的 server、排程與 lineage／release 模型，都是替代 Actions 所必需的元件。 |

## 14. 待 plan 階段定案（不阻擋本規格核准）

- HTTP 框架：Fastify 5 或 Hono。
- 排程：使用 croner，或自行實作 UTC cron 解析。
- Kysely 搭配 `node:sqlite` 或 `better-sqlite3`（R-DATA-03）。
- 是否需要 FTS5 trigram。
- 是否把 schema 升到 v4（需遵守 R-DEP-42）。
- runtime base path 的實作方式（R-DEP-14）。
- R-DATA-10 交易綁定與一次性消費的具體機制（例如每個寫入交易的 token），需滿足 R-DATA-10 的不變式與 R-DATA-14 的拒絕測試。
- `state.json`、commit log 與 attempt manifest 的確切 JSON schema（欄位語意依 R-ARCH-03、R-OPS-03）。
