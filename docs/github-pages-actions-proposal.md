# GitHub Pages + Actions + SQLite / SQL.js-HTTPVFS

狀態：使用者指定的目標架構，遷移分支實作中，尚未正式部署。
分支：`design/github-pages-actions`。

本方案取代先前的 JSON 分片／TypeScript 全量查詢設計。公開資料庫是 SQLite；
瀏覽器必須實際使用 `sql.js-httpvfs`，不是下載 JSON 後自行模擬資料庫。

## 設計草圖

```text
private GitHub Releases checkpoint
               |
GitHub Actions: 還原暫時 PostgreSQL + 原始物件
               |
      同步 Leaguepedia / 驗證 provenance
               |
      匯出唯讀 SQLite + 索引 + 展示資產
               |
      SQLite / PostgreSQL 差分驗證
               |
      Vite 建構 + 真實 Worker/Range E2E
               |
GitHub Pages: HTML / JS / worker.js / WASM / database.sqlite
               |
Browser: SQL.js-HTTPVFS Web Worker
               |
    HTTP Range 206 按需讀取 SQLite 頁
               |
    SQLite SQL 搜尋 / 聚合 / 篩選 / 分頁
```

## 資料庫責任

- **SQLite**：唯一公開查詢資料庫。保存已發布、有效的 entities、歷史隊名、賽事、
  series/games、逐局 roster、coverage 與展示資產 metadata。
- **PostgreSQL**：僅 Actions 同步與建構時的暫時工作區，沿用既有 migrations、
  publication transaction 及來源稽核。不是網站服務，也不是外部託管資料庫。
- **Private Releases**：保存 PostgreSQL checkpoint、原始來源、失敗證據與網站版本。
  raw bytes、私密設定、token、DB dump 不會進入公開 SQLite 或 Pages。
- **Browser**：只讀 SQLite，不直接寫 repository，也不包含 GitHub token。
  個人收藏仍使用 localStorage。

GitHub-only 指運算部署及持久保存；Leaguepedia 是外部來源，npm 是建構相依來源。

## 公開產物

```text
index.html
assets/<hashed-app-files>
assets/<hashed-sqlite-worker>.js
assets/<hashed-sql-wasm>.wasm
data/manifest.json
data/<database-sha256>/database.sqlite
presentation/<content-sha256>.svg
```

Manifest schema version 2 保存 logical snapshot ID、SQLite checksum/size、4096-byte
page size、dataset/coverage/freshness 等小型 metadata。沒有 entities/series JSON 分片。
logical snapshot ID 綁定 cursor；SQLite bytes 的 SHA-256 綁定不可變檔案 URL。
更新時產生新 URL，不覆寫正在被舊頁面讀取的 SQLite；站台封裝保留目前及上一版。

SQLite 使用 `journal_mode=DELETE`、4096-byte page、索引、`ANALYZE`、`VACUUM`，
發布前驗證 `integrity_check`、檔案 checksum 與歷史對戰結果。
瀏覽器不為了驗證整檔 SHA 而先下載整個 DB；它依賴已驗證產物、HTTPS、不可變 URL
及內部 snapshot identity。這不等同於對每個 HTTP Range 進行密碼學驗證。

## 新增與移除

新增：SQLite exporter/schema/indexes、共用參數化 SQL query adapter、SQL.js-HTTPVFS
worker/WASM 資產、HTTP Range preflight、SQL 差分測試及真實按需讀取 E2E。

立即移除尚未發布的 JSON facts writer/loader、JSON shard contract，以及
`compareSnapshot/searchSnapshot` 全量 TypeScript 查詢主路徑。不保留格式切換或 fallback。
build-time projection 可以暫存於記憶體供匯出／驗證，不會成為網站的資料載入路徑。

正式切換驗收後移除：Fastify API、常駐 PostgreSQL serving、S3/MinIO transport、
app cron、production Docker stack、HTTP runtime 與舊 online SQL tests。
保留 checkpoint/recovery、raw provenance、migration、歷史結果及 v2 頭像演算法。
實體資料、volume、舊備份不隨程式退役刪除。

## 驗收與風險

- 必須實際啟動 `sql.js-httpvfs` worker 與 WASM，不接受只有 adapter mock 的驗收。
- SQLite 請求必須使用 Range 並收到正確 `206 Content-Range`；不支援 Range 時明確
  失敗，不退回全量 GET、JSON 或 HTTP API。實際 Pages URL 上線前需重測。
- SQL 搜尋、player/region/team-era 比較、逐局 roster、摘要和分頁對照既有 PostgreSQL。
- 測量實際下載 bytes、首次查詢與後續查詢；`serverMode: full` 表示單一 SQLite
  檔案的服務配置，不表示先下載整檔。
- 上游專案明示偏向個人專案，要求 WebAssembly/Web Workers，且沒有 cache eviction。
  鎖定 `sql.js-httpvfs@0.8.12`，設定讀取上限，以真實瀏覽器測試補足整合風險。
- 保留原 pinned archival acceptance；current SQLite acceptance 獨立驗證來源及
  原 reviewed 日期範圍內的預期結果，不改寫舊 reviewed JSON 來消除版本差異。

官方實作依據：`phiresky/sql.js-httpvfs` README、套件本身的 worker/type definitions。
詳細執行批次見 [SQLite 遷移計畫](aegis/plans/2026-09-14-sqlite-httpvfs-migration.md)。
