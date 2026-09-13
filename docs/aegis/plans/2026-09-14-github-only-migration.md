# RiftVersus GitHub-only 遷移計畫

> 已被使用者要求的 [SQLite / SQL.js-HTTPVFS 計畫](2026-09-14-sqlite-httpvfs-migration.md)
> 取代公開資料與查詢層設計。以下 JSON 分片內容僅保留作歷史決策紀錄，不可繼續實作。
> P0-P2 checkpoint 成果與原始資料保護邊界沿用。

日期：2026-09-14（Asia/Taipei）。狀態：使用者已授權實作與逐階段 commit；P0 已驗證，P1 進行中。
需求：完全使用 GitHub 維運與保存資料，明列新增、替代、保留與移除的流程。
設計依據：[目標設計](../../github-pages-actions-proposal.md)。
分支：`design/github-pages-actions`；起始 HEAD：`53095f2ee06e343c1e64c8b8d452ca939922ca75`。
本輪開始時 `.gitignore`、`docs/README.md` 已修改，設計文件未追蹤；`.gitignore` 不屬於本計畫編輯範圍。

## 1. 目標與邊界

最終正式運作只依賴 GitHub Repository、Releases、Actions、Pages；不需要常駐 Fastify、PostgreSQL、MinIO、外部 S3 或 self-hosted runner。
PostgreSQL 17 保留為 GitHub-hosted Ubuntu runner 內的暫時 service container，以及本機資料工具的開發依賴。[S1]
Leaguepedia 仍是唯一資料來源；GitHub-only 不表示禁止上游資料 API 或 npm／容器 registry。

| 責任 | 最終唯一 owner |
| --- | --- |
| reviewed mappings、schema、程式碼 | 網站程式 repo 的 Git history |
| 可還原資料狀態與來源證據 | private 資料 repo 的已驗證 checkpoint Releases |
| 一次性同步、migration、封存、匯出 | `apps/data` CLI + `packages/sync`／`packages/database` |
| 正式同步與網站發布排程 | 網站 repo 的單一 `publish.yml` |
| 搜尋及比較規則 | `packages/domain` 純 TypeScript 引擎 |
| 網站與公開快照 | Pages 的單一完整部署產物 |
| 已部署網站識別 | GitHub Pages deployment 紀錄 + 實際站台 `site-manifest.json` |

不包含 UI 改版、第二資料來源、即時比分、SQLite 遷移、所有兩兩比較預計算、第三方監控、永久刪除既有資料。
使用者已授權依計畫實作，每階段驗證後 commit。尚未指定遠端 repository；不推測帳號或公開位置，不刪除既有資料。

## 2. 現況與不可退化的行為

已核對 `README.md`、`docs/deployment.md`、ADR-0001、2026-07-18 identity/avatar baseline、2026-09-13 scheduled refresh plan，以及下列實作。
現況由 Fastify 接查詢、PostgreSQL 持有 publication generation、S3 保存 immutable sources/media、Compose sync 常駐排程。
`apps/web/src/api/types.ts` 已有可替換的 `ComparisonApi`；正式 runtime 仍綁 HTTP，development/test 預設綁 mock。
`packages/domain/src/comparison.ts` 不是 SQL 查詢的完整替代品，還需補 leagues、搜尋、分頁、metadata 與歷史列組裝。

必須保留：

- 選手搜尋 `ID (本名)`、選定主體的簡短摘要、歷史列使用當時 team/team-era。
- 逐局出賽名單、換人、隊史、賽區、日期與 BO／league／event 篩選、系列賽與小局統計。
- 部分 coverage、缺資料、無發布資料的明確狀態；不可把 fetch 失敗當零場。
- 合規 retained media 優先，否則產生 v2 字母頭像；維持 2–3 字元、ASCII 與賽區區分。
- query URL、localStorage 收藏、完整分頁匯出、PNG／ZIP；舊 origin 收藏不會自動搬移，發布說明需揭露。
- reviewed source mapping、來源 checksum、parser version、override 記錄、retired facts 與既有歷史 acceptance。

基線判斷：這是經使用者指定的新架構方向，不是修補目前 runtime drift。
正式切換時修訂 ADR 的 runtime/storage/presentation 邊界；本計畫不把舊基線改寫成「已完成」。

## 3. GitHub 儲存設計

### Repository 與權限

網站 repo 保留程式碼、fixtures、overrides，並承載 CI、正式工作流與 Pages。
另建 private `RiftVersus-data` repo（名稱可依帳號調整），只保存資料 Release 與最少說明文件，不放第二套同步程式。
private 封存避免原本私有 raw envelope、完整 DB 與錯誤紀錄因遷移變成公開；Pages 只包含明確允許發布的資料。

網站 workflow 用自己的 `GITHUB_TOKEN` 發布 Pages。跨 repo 封存先使用 fine-grained PAT，僅限資料 repo 的 Contents 讀寫與必要 metadata，存於 `RIFTVERSUS_DATA_TOKEN` secret；設定到期及輪替紀錄。[S2]
`DATA_REPOSITORY` 是非機密設定。PAT 只注入需要下載／上傳的受信任步驟，不傳給 Vite、PR、fixture 測試或瀏覽器。
只有 default branch 的正式 workflow 與人工 recovery 可寫資料 repo；PR 不得以 `pull_request_target` 執行不受信任程式後使用此 token。
檔案需要 checksum／大小核對及安全解壓，拒絕路徑穿越、symlink／hardlink 與重複衝突 key。

### 三種 Release

| Release 前綴 | 內容與用途 | 是否可當同步基準 |
| --- | --- | --- |
| `checkpoint-<sequence>-<run-id>` | 完整 DB dump、完整物件索引、公開 snapshot、檢查結果與新增物件 packs | 只有完整驗證並發布者可以 |
| `attempt-<run-id>` | 失敗 scope、錯誤、已捕捉原始證據與執行結果 | 不可以 |
| `site-<run-id>` | 完整網站 bundle、code SHA、checkpoint ID、snapshot ID、checksum | 不可以；僅用網站重部署 |

每個 checkpoint 的 manifest 記錄 `checkpointSchemaVersion`、`checkpointId`、`sequence`、`parentCheckpointId`、PG major、migration 集合、code SHA、dataset version/generation、逐 scope checkedAt、coverage、檔案大小與 checksum。
Release tag 屬於資料 repo 自己的 commit；manifest 的 code SHA 另行指向網站程式 repo，不能誤把兩個 repo 的 Git SHA 混用。
`checkpointId` 是每次成功檢查的版本；dataset version 仍保留既有事實語意。unchanged sync 也保存新的 checkpoint，讓 checkedAt 與健康狀態不因 runner 結束而遺失。
公開 `snapshotId` 由公開資料與 metadata 的 canonical manifest 決定；更新 checkedAt 時不能覆寫相同 snapshot 路徑。

每次 checkpoint 保存完整 DB dump，不建立 DB 增量鏈。raw/media 以原有 object key 保存，pack 依 checksum 去重，manifest 列出完整所需 object → Release ID／asset ID／pack 位置對應，不逐代追查 parent 才能還原。
單個 pack 的初始目標不超過 256 MiB；DB dump／公開 bundle 過大也分片，順序與合併 checksum 放入 manifest。
上傳前檢查每個 asset 小於 2 GiB、單 Release 不超過 1,000 assets；不符合就失敗並調整分包，不放寬平台限制。[S3]
初期保留所有正式 checkpoint 與被引用 packs；不新增自動刪除流程。日後容量整理必須先分析完整引用關係及還原可行性。

### 發布與還原契約

1. 在唯一 writer 鎖內解析資料 repo 所有 checkpoint manifests，依已驗證 sequence／parent lineage 找到最新有效版本；不依賴 GitHub `latest`、標題排序或只讀第一頁 API 結果。
2. 還原完整 DB 與必要物件到新 runner，核對所有 checksum、PG major 與 migration 相容性；任何必要 pack 缺失就停止，不自動重抓上游補洞。
3. 執行同步後，PG 的 publication generation 只是此次 runner 的候選狀態。必須完成遠端封存和還原驗證，才算持久發布。
4. 建立 draft Release，附齊 DB／公開快照／物件 packs／manifest，在第二個空白 DB 還原並驗證，再 publish。資料 repo 啟用 immutable releases；發布後不覆寫 tag 或 assets。[S4]
5. draft、失敗 attempt、manifest 不完整者永不作基準；重試使用 run ID 與 checksum 識別同一次產物，避免生成分叉或覆寫。
6. 新 checkpoint 成功後可獨立於 Pages 成功存在。網站部署失敗不撤回 checkpoint，下一次同步仍使用最新有效 checkpoint。

S3 被 filesystem ObjectStore 取代：保留 `get`、`head`、`putImmutable` 與 checksum/contentType/byteSize 語意；移除 HTTP redirect 才需要的 `signedGetUrl`。
P1 先將簽名能力從核心 ObjectStore 拆到舊 HTTP delivery 的窄介面，調整舊 S3／media 型別引用，使 filesystem 不需實作假的簽名方法；P7 連同舊 HTTP delivery 刪除此介面。
同 key 不同 checksum 必須報錯；metadata 也要保存與核對。source key 不因搬儲存而改寫，不能重新生成歷史 provenance。
本機檔案只是 staging，Release 才是持久 owner；目前「先存 S3 再發布 DB」的耐久邊界需明確改為上述 checkpoint 契約。

## 4. 新增的工作流程

### A. 首次搬遷／bootstrap（人工觸發一次）

1. 盤點當前 PostgreSQL／MinIO、資料量、generation、source/media keys 與 metadata。記錄來源版本，不把舊文件的數量當本次量測。
2. 擷取一致的 DB snapshot，按該 snapshot 引用的 object keys 匯出 immutable bytes；來源 append-only 的新增不混入此次版本。
3. 在隔離的暫時 PG＋filesystem 中還原，保留 ID、時間戳、退休記錄、overrides、coverage；對照正式 SQL、歷史 acceptance 與來源 bytes。
4. 建立第一個完整 checkpoint，於全新 runner 僅從 GitHub 下載還原，證明不再依賴本機 MinIO。
5. 正式切換前停止舊排程並重做最後一致快照；核對 preview 與最後資料差異，之後只讓 Actions 更新。移除舊流程之前保留獨立備份。

bootstrap 不透過重新 backfill 取代既有歷史資料；未知物件或缺失 evidence 需先處理，不能 silently skip。

### B. 程式碼 CI（`ci.yml`）

PR 執行 workspace build、型別／lint、unit、真實暫時 PG integration、fixture snapshot、production 靜態 Playwright。
不讀正式 private archive，不呼叫 Leaguepedia，不建立 Release、不部署 Pages。fixtures 保持明確 synthetic，不能建立 live coverage 證明。
PR 與正式網站都使用同一個靜態 runtime；mock 僅限測試中的顯式依賴注入。

### C. 正式資料與網站發布（`publish.yml`）

所有正式工作使用 workflow-level `concurrency` group `riftversus-publish`、`cancel-in-progress: false`；使用平台的 `queue: max` 排隊，仍不能依賴 dispatch 順序判定新舊。[S5]
取得執行權後重新解析有效 checkpoint、default branch SHA 與待更新 scopes；過期 code push 不得用舊 code 覆蓋新站。
PG advisory lock 仍保留為本機交易防護，但不能保護不同 runner 的獨立 DB，跨 runner 序列化由上述 workflow 負責。
所有資料／網站寫入都走此入口，不另設可繞過鎖的 release-trigger workflow。

| 觸發 | 行為 |
| --- | --- |
| default branch push | 讀最新相容 checkpoint，測試、建構、封存並部署網站；不重抓來源 |
| 每日 UTC `17 19 * * *` | 台北每日 03:17；還原、一次性更新明確 active scopes，再建構部署 |
| 每週 UTC `47 20 * * 6` | 台北週日 04:47；更新 reviewed 歷史 scopes，再建構部署 |
| `workflow_dispatch` | 明確模式：當年／歷史／bounded backfill／schema 重匯出／重部署／回滾 |

排程沿用現有每日／每週需求。workflow 的 UTC 時間寫入文件，不再保留 app 內 cron 時區設定。
schedule 僅 default branch 生效、可能延誤／漏跑，public repo 無活動 60 天會停用；保留手動執行、scope freshness 與停用檢查。[S6]
若 main push 的新 schema 無法讀 checkpoint，停止部署，透過明確的 migrate＋re-export 模式產生相容 checkpoint；不切換 mock 或任意舊版本。

資料更新依序：restore → migrate → mapping check → sync → source/coverage 驗證 → snapshot export → 新 DB 還原驗證 → publish checkpoint → build/test → archive site → deploy Pages → 讀取線上 manifest 與 smoke test。
全批要求成功才 promote checkpoint；某 scope 失敗時仍可收集其他 scope 診斷，但此次成功部分不發布，避免 partial run 被誤當整體完整更新。
資料發布和網站發布使用同一 workflow 的 `needs`，不依賴 `GITHUB_TOKEN` 建 Release 觸發其他 workflow。[S7]
Pages job 僅接收已驗證公開網站 artifact，使用 `pages: write`、`id-token: write` 及 `github-pages` environment。

### D. 失敗、freshness 與人工重試

失敗時把既有 `RetainableStageError` 捕捉到的 raw、scope 結果與錯誤寫到 `attempt-*` Release；不僅保留短期 Actions artifact。
連續失敗次數從持久 attempts／成功 checkpoint 計算，不依賴下次會被丟棄的 runner DB `sync_runs`。
若 token／GitHub 本身故障，無法保證新增 evidence 已遠端保存：workflow 明確失敗，不宣稱已封存；原站與有效 checkpoint 不受影響。
runner 硬中斷可能來不及保存 raw；重新執行由有效 checkpoint 開始，缺失嘗試資料標為未知，不捏造成功紀錄。
逐 scope stale 門檻沿用 36h／192h 與失敗門檻 3；重新命名為資料檢查設定，移除 HTTP health endpoint。
網站依據 snapshot checkedAt 顯示過期資料；網站只能知道其快照的新鮮度，不能假裝知道尚未部署的失敗事件。
維運使用 GitHub Actions 結果／Job Summary、attempts 與手動 freshness check，不新增 Slack／email bot；GitHub 通知由使用者訂閱設定負責。

### E. 網站回滾與資料恢復

一般回滾指定 `site-*` Release，驗證 bundle 後在同一發布鎖內重新部署，並核對線上 `site-manifest.json`。
站台 manifest 記錄 site build ID、code SHA、checkpoint ID、snapshot ID；部署成功但 smoke test 失敗時標示失敗，允許以先前 bundle 回復。
回滾網站不修改資料 checkpoint lineage；已驗證新資料不因舊網站重新上線而遺失。
需要資料修復時在新 candidate 上修正／驗證並產生新的 sequence，不刪除或重指舊 Release；整體災難恢復必須同時驗證 DB、物件索引與所有 packs。

## 5. 靜態資料與前端契約

新增 `packages/contracts/src/snapshot.ts` 定義公開 snapshot：entities、searchable aliases、team eras、tournaments/league、series/games、逐局 membership、coverage、attribution 與版本 manifest。
資料庫匯出在固定 generation／一致 transaction 下完成，涵蓋全部保留 scopes 的有效 facts；series metadata 不取代逐局出賽資訊。
按賽事／年份分片；summary 必須讀完所有符合 query 的分片，不能只算畫面當頁。不先產生 N² 對戰資料。
`packages/domain` 承接完整搜尋、比較及分頁語意；`ComparisonApi` 維持 UI 介面，輸出仍符合 `ComparisonResponse`。
先以舊 SQL 建立已審核 golden 結果與差分測試；完成後刪除正式 SQL comparator，不在 runtime 留雙引擎。
P3 同步將 acceptance 的 compare dependency 改接該靜態引擎；DB 仍用於核對原始 provenance。`acceptance-media` 改依公開 manifest 解析資產並驗證 bytes／license／頭像 identity，不因 URL 形狀改變而移除驗證。

Vite `base` 與 Router basename／資產／fetch／匯出路徑統一；支援 project path `/RiftVersus/`，保留 query string 分享方式。
每個 React Query key、分頁 cursor 與匯出工作綁同一 snapshot；公開 schema 不相容時顯示需更新，不偷偷轉接 HTTP。
namespace 用 snapshot ID，部署保留目前與上一份完整公開 snapshot；更舊頁面缺檔時要求重載，避免跨版混算。
公開 snapshot 規定 ISO 日期、穩定 ID 排序、tie-breaker、literal 搜尋字元語意；多 alias／era 去重與空查詢行為對照舊測試。

v2 頭像生成器移到 build CLI，僅一份演算法；輸出 `/presentation/<content-hash>.svg`，不寫入 DB source/media provenance。
retained media 只在 license/attribution 合格且 bytes 可驗證時複製到公開站，同樣採內容雜湊 URL。
Fastify 的 ETag、`/avatars/v2/...`、`/media/...` URL 與 API HTTP 行為列為退役契約，不能假設 Pages 支援相同 header 或 redirect。
已有輸出檔案中的歷史 image URL 不會自動被改寫；若盤點發現外部依賴，先完成消費者搬遷，不能宣稱 API URL 相容。

## 6. 實作批次、檔案與驗收

以下路徑與新 commands 為計畫介面，尚不存在的能力不得當成已可執行。
批次按依賴順序逐一執行；P0 證據不足時先解決資料缺口，不啟用自動發布。

| 批次 | 主要檔案／責任 | 交付與離開條件 |
| --- | --- | --- |
| P0 基線盤點 | `docs/operations.md`、`data/acceptance/*`、既有資料庫／MinIO 的唯讀盤點 | 一致 snapshot、所有引用物件與 checksum、資料量／封存估算；保留可回復副本，無來源重新抓取 |
| P1 建構工具與本機物件庫 | 將 `apps/server/src/{cli,commands,config,sync-service,sync-plan,mapping-check,sync-health,acceptance-cli,acceptance,acceptance-media,avatar}.ts` 的合法職責移至 `apps/data/src/`；新增 `packages/sync/src/storage/filesystem.ts`；調整 `storage.ts`、各 package／tsconfig | 一次性 sync/migrate/backfill/acceptance 可用 PG＋filesystem 執行；保留 source bytes 與 metadata；無 server 啟動需求 |
| P2 封存／還原 | 新增 `apps/data/src/{checkpoint,release-store}.ts` 及對應 tests；GitHub transport 與 checkpoint 驗證分開 | fixture 可 pack→draft upload→download→全新 DB restore，缺檔／衝突／中斷不能 promote；attempt evidence 可持久保存 |
| P3 公開 snapshot／比較引擎 | `packages/contracts/src/snapshot.ts`、`packages/database/src/repositories/snapshot.ts`、`apps/data/src/export-snapshot.ts`、`packages/domain/src/{comparison,search,snapshot-query}.ts` 與 tests | 全部 scopes 有完整 game membership；舊 SQL 與靜態結果一致；歷史 acceptance 與分頁／coverage 通過 |
| P4 靜態 UI | `apps/web/src/api/{snapshot-client,static-runtime}.ts`、`types.ts`、`app.tsx`、`model.ts`、`vite.config.ts`、export 功能與 Playwright configs/tests | 正式網站不依賴 API、DB、上游；Pages base path、搜尋、分享、完整匯出、桌面／手機通過 |
| P5 GitHub workflows | 新增 `.github/workflows/{ci,publish}.yml`、`apps/data/src/{site-bundle,freshness}.ts`；調整根 scripts、`.env.example` | PR 無正式 secrets；更新／unchanged／失敗 attempt／重試／回滾／防舊版覆蓋均驗證；部署只接受完整 artifact |
| P6 Bootstrap 與切換 | GitHub repo/settings/secrets、`docs/{operations,deployment}.md` | private archive bootstrap；全新 runner GitHub-only restore；正式 Pages smoke；停止舊 sync 後完成最後資料交接；至少一次 current 與 history 實測 |
| P7 舊流程退役 | 下節所有程式、依賴、測試、文件及根工作區設定 | 新主路徑單一 owner；reference scan、負向測試與完整 gates 通過；舊備份／volume 尚保留 |

P1 的 `sync-schedules.ts` 只搬有用的 history 分組／一次性執行到 `apps/data/src/sync-plan.ts`；不搬 `runSchedules` 或常駐 lifecycle。
P1–P4 僅在遷移分支短暫保留舊 SQL／HTTP 作對照，不能把新舊選擇暴露成產品永久設定。P7 是同一遷移計畫的必要工作，不是可忽略的後續整理。
`apps/server/src/index.ts`／types/errors 中的有效內容按引用搬移；不能整包換名並留下 Fastify 相依。

### 預定 CLI 與檢查命令

根新增 `pnpm data` 映射至 `node apps/data/dist/cli.js`；以下子命令在對應 P1/P2/P3/P5 批次加入並測試 parser：

- `migrate`、`sync --once`、`sync --history-once`、bounded `backfill`、`sync-map-check`：保留一次性功能，無不帶旗標的常駐 `sync`。
- `checkpoint pack|verify|restore`：明確 manifest、object directory 與輸出路徑；restore 僅允許空白 staging DB，拒絕既有非空 DB。
- `snapshot export|verify`：匯出指定有效 generation，驗證公開 schema、所有分片與 checksum。
- `archive resolve|publish`、`attempt finalize`：Release 存取與狀態校驗；不新增通用 GitHub API／排程框架。
- `acceptance`、`freshness`：保留驗收與健康語意，去除 HTTP／S3 endpoint 相依。

沿用／調整的確切測試入口：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm --filter @riftversus/web build
pnpm test:e2e
pnpm test:e2e:release
pnpm acceptance:check
```

P1 增加 `@riftversus/data` 的 workspace test 並搬移合法 CLI 測試；`acceptance:check` 指向新 CLI。仍留作對照的 server suite 持續執行，P7 才移除 server test 入口及 workspace reference。
integration 使用新建 PG17、正確測試 DB 環境與 migration，移除 `--passWithNoTests`，缺 DB／零測試／skip 不可代表正式驗證成功。
P4 將 `test:e2e` 改成 production 靜態 build 的 preview，使用可用 port；`test:e2e:release` 保留指定 base URL 入口，但不再透過 API 讀 dataset version。
保留 pinned 歷史 provenance acceptance；新增 snapshot acceptance，不能只改 expected 值讓新版本通過。

### 執行時釐清：歷史封存與當前版本驗收

P0/P1 的實測確認，既有 reviewed gen4 驗收同時固定 global dataset version、
coverage 及 fact generation；因此正常發布 gen7 後，對當前 DB 執行它也必然失敗。
這不能透過更新 reviewed JSON、忽略 mismatch 或宣稱舊驗收通過來處理。

P3 將驗收分成兩個明確用途：

- **Pinned archival acceptance**：保留原 verifier 與原 reviewed JSON，只對相符的
  歷史 checkpoint 執行。對 gen7 的結果仍是 blocked，完整保留診斷。
- **Current snapshot acceptance**：公開 snapshot 必須完整對應當前 published DB
  projection；每個 active series/game 必須有有效 publication/audit/source 連結，
  引用 raw bytes 必須符合 checksum/size/content type。靜態圖片須符合生成器 identity
  或 retained media 授權及 bytes。歷史對戰結果在原 reviewed 日期範圍內，直接使用
  原 expected rows、勝負及媒體 checksum 核對，不改寫預期內容。

這是修正驗收適用範圍，不是放寬來源或歷史結果要求。正式新版本以 current gate
驗證；沒有相符 gen4 checkpoint 時，不宣稱完成 gen4 冷還原或 pinned archival gate。
ADR 與正式 runtime baseline 在 P6/P7 實際切換後更新，這裡先記錄分支上的遷移決策。

## 7. 移除與保留清單

| 現有流程／carrier | 新承接者 | 退役時機與具體處理 |
| --- | --- | --- |
| Fastify `serve`、`apps/server/src/{app,server}.ts`、routes | Pages＋靜態 runtime | P7 刪除 HTTP process/routes 與 Fastify plugins；合法 CLI／驗收先移至 `apps/data`，最後移除 `apps/server` workspace |
| `/api/entities`、`/api/comparisons`、`/api/filters`、`/api/dataset` | 公開 snapshot＋domain engine | P4 UI 移轉，P7 刪 `client.ts`／`http-runtime.ts`／舊 runtime re-export；比較 URL state 序列化搬入 model，不連帶刪功能 |
| PostgreSQL 線上 query serving | PG 僅 sync/export/acceptance | P7 刪 `repositories/comparison.ts` 的正式 SQL comparator、entities 的線上搜尋與只用於 HTTP 的 helpers；snapshot 仍需要的 projection 收斂到 snapshot repository |
| 線上 SQL query-plan／API latency gates | snapshot correctness、browser query、下載量與解析成本 | P7 移除 `query-plan.integration.test.ts` 的 online-serving 指標；遷移 golden fixtures 與比較邊界測試先保留到 domain |
| `packages/sync/src/scheduler.ts`、server `runSchedules` | Actions schedule／單 writer workflow | P7 刪 `scheduleSync` export、`croner` 與 cron lifecycle tests；保留 history scope 分組與 bounded sync |
| Docker startup 自動同步、`SYNC_RUN_ON_START` | workflow triggers | P7 刪 restart/startup catch-up、`SYNC_CRON`／`SYNC_HISTORY_CRON`／`SYNC_TIMEZONE`；不靠容器啟動更新 |
| S3 transport、bucket bootstrap、signed URL | filesystem staging＋private Releases | P2 驗證替代後，P7 刪 `storage/{s3,bootstrap}.ts`、`S3ObjectStoreConfig`、AWS SDK、S3 server factory 與 `S3_*`／`MINIO_*` 設定 |
| `/media` proxy／redirect、`MEDIA_DELIVERY` | 已授權媒體的靜態資產 | P4 確認 PNG/ZIP 同源可用，P7 刪 proxy、presigner、`signedGetUrl` 與其專用測試 |
| `/avatars/v2/...` HTTP handler、ETag cache helper | 單一 build-time v2 generator | P7 刪 route／`http-cache.ts` 的 HTTP 專用功能；移植生成器測試，保留 v1 不可用的負向行為 |
| `/health/ready`、sync-health HTTP、Compose healthchecks | workflow status、freshness CLI、公開 checkedAt | P7 移除 HTTP 及常駐 process checks；保留 PG service 啟動檢查與資料 fresh/partial/failure 規則 |
| production Dockerfile、Compose app/sync/migrate/minio | Actions jobs＋PG service | P6 停用舊服務，P7 移除 `Dockerfile`、`compose.yaml`、`docker/entrypoint.sh`；可提供僅本機測試用 PG setup，不恢復完整 stack |
| runtime-image packaging、`scripts/{runtime-artifact,static-runtime-preflight}.mjs` | 靜態 site bundle 檢查 | P7 刪 `test:runtime-artifact`、Docker image/RSS gates 及對應測試；加入公開檔案 allowlist、資產完整性與大小檢查 |
| Vite development 自動 mock | 真實靜態 fixture/live snapshot | P4 移除 mode 隱式 alias；mock 移入 test-only helper，由測試明確注入，不當正式 fallback |
| `.env.example` 的 app/server/storage 設定 | Actions vars/secrets＋資料 CLI 設定 | P7 刪 PORT/HOST、server/media/S3/cron 變數；保留來源限制、mappings、臨時 DATABASE_URL，加入 object dir／資料 repo 設定 |
| 舊部署與運維說明 | GitHub-only operator guide | P7 更新 README、docs index、deployment/operations/source attribution；舊 Aegis 證據標示歷史用途，不改寫舊驗證結果 |

保留而不是移除：`packages/database`、既有 migrations 001–009、publication transaction／generation、retirement／audit tables、provider parser、人工 mappings、checksum／license gate、v2 演算法、frontend contracts 和使用者可見功能。
`008_entity_search_indexes` 的既有 migration 與 DB 相容性保留；不用 online search 不代表可刪歷史 migration 或立即 drop index／extension。
`test/source-retirement.test.ts` 的 Oracle／舊 avatar 防回歸意圖保留，修正其檔案定位；不因舊 server 搬移就整組刪除。
`test/{workspace,scripts,deployment,runtime-artifact,playwright-release-config}.test.ts` 逐條分類：有效能力改接新入口，只綁舊載體的斷言才刪除。

退役分類：內部程式與設定在新 owner 驗收後刪除；已分發 API／媒體 URL 先盤點消費者並記錄不相容性。
持久 DB rows、MinIO objects、Docker named volumes、既有備份不隨程式退役自動刪除。實體清理不是完成本計畫的必要條件，日後需列出明確對象與備份再另行授權。

## 8. 量測、失敗測試與完成條件

P0 記錄 facts/object 數量、完整／分片 archive 大小與估計 runner 磁碟需求；P6 實測 download／restore／sync／export／build／deploy 時間與尖峰磁碟。
初始工程預算（不是既有結果）：含上一 snapshot 的 Pages 產物 <800 MiB；一般首屏所需 JS＋索引＋metadata 壓縮量 ≤2 MiB；記錄實際 HTTP encoding，不假設 Pages 使用特定壓縮算法。
量測固定桌面與手機環境，要求資料載入後比較 p95 ≤200ms、搜尋 p95 ≤100ms；worker／分片調整需由量測觸發，不提前新增 WASM 或第二引擎。
Pages 官方發布大小上限為 1 GB，部署 timeout 10 分鐘；整個同步 job 另依當時 Actions 限制設定有限 timeout，不能把此 10 分鐘當同步上限。[S8]
若容量或 runner 實測不合格，先調整資料分片與 evidence 打包；不私自引入外部儲存或降低原始證據完整性。

必要驗收矩陣：

| 測試 | 預期 |
| --- | --- |
| 全新 runner，沒有 cache／本機資料／S3 | 單靠 GitHub checkpoint 完整恢復並更新 |
| 日更只包含當年 scopes | 歷史 scopes、ID、來源證據不消失 |
| 來源 unchanged | dataset facts 不重覆，checkpoint／checkedAt 更新 |
| 一個 scope 失敗／未知 mapping／部分 coverage | 不 promote 整批，舊站保留，attempt 有可追溯證據 |
| pack 缺失／checksum 錯／安全解壓失敗 | 拒絕 restore 或 publish，不補造來源 |
| runner 中斷於 draft upload／publish／Pages deploy | 下次只解析有效 checkpoint；可重試，不出現半成品正式站 |
| 兩次排程加 code push 交錯 | 單 writer，重新解析基準，舊 code 不覆蓋新 code |
| Pages 部署成功、post-deploy check 失敗 | 顯示 workflow 失敗，可指定舊 site bundle 回復 |
| 手動網站回滾後再同步 | 使用最新有效資料 checkpoint，無資料倒退 |
| 舊頁面跨部署分頁／PNG／ZIP | 同一 snapshot 或明確要求重載，不跨版本彙總 |
| 關閉所有本機舊服務訪問 Pages | 搜尋、比較、分享、收藏、頭像、匯出可用，無 `/api`／上游請求 |
| PR 與公開 bundle | 無 private token、DB dump、raw evidence、未授權 media |

P7 另做主路徑 reference scan：`fastify`、`createS3ObjectStore`、`bootstrapS3Bucket`、`scheduleSync`、`signedGetUrl`、S3/cron/media env、舊 server path 不可存在於正式 source/config/lockfile。
歷史 docs、retirement 負向測試可保留字串，但需標明用途。確認 browser bundle 不含 PG／Node-only／GitHub credential 模組。
停止舊流程不以「測試變綠」單獨判定：必須同時完成 GitHub-only cold restore、live current/history、production Pages smoke、回滾演練與 owner/reference 清理。

## 9. 計畫檢查與交付狀態

- 需求已足夠擬定計畫：完全 GitHub、現有資料與使用體驗保留、新增及移除流程都在本文件。public Pages＋private archive repo 為本計畫建議的預設拓樸。
- 實作必要性：改 workflow 無法替代 HTTP 比較、S3 原始證據或跨 job 狀態；最小新 owner 是 data CLI、snapshot contract/domain、Release transport 與靜態 runtime。
- 複雜度界線：重用現有 sync/domain/contracts，只有兩份 workflow；不用 API fallback、雙排程、常駐服務或通用工作流引擎。
- TDD Route：mode `off`、decision `skipped`（strict 不適用）；執行時做有風險對應的回歸、差分與恢復測試，不要求形式化 RED/GREEN。
- 執行路徑：後續按 P0–P7 inline 分批執行；本輪僅規劃，不轉入 implementation。
- 目前未設定 git remote（本輪 `git remote -v` 無輸出），尚未確認遠端 repo visibility／plan、Pages 設定、private archive、token 與 GitHub runner 來源連線；這些是 P0/P6 準備條件，不是假設已完成。
- 架構修訂：P7 更新 ADR-0001 runtime/presentation/storage 邊界，另記當時新 baseline 與驗證證據，保留先前歷史記錄。
- 本輪完成標準：設計與計畫一致、索引可達、每個退役項目有新 owner 與驗收、文件無 whitespace 錯誤。不宣稱已驗證部署效能或資料遷移成功。

## 10. 官方參考

本輪查閱日期：2026-09-14。平台設定與 action SHA 在實作時再次核對。

- S1 PostgreSQL services：<https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers>
- S2 Workflow authentication：<https://docs.github.com/en/actions/security-guides/automatic-token-authentication>
- S3 Release limits：<https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases>
- S4 Immutable releases：<https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases>
- S5 Concurrency：<https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>
- S6 Schedule：<https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule>
- S7 Workflow chaining：<https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow>
- S8 Pages limits：<https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>
