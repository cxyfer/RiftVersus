# RiftVersus MVP execution - Intent

## TaskIntentDraft

- Requested outcome: 完成可驗收的 RiftVersus MVP，採用分階段 subagent-driven 實作與 commits
- Goal: 依核准設計與計畫完成可驗收的 Docker 化 LoL 對戰統計網站
- Success evidence:
- 13 個計畫任務完成、reviews、測試、Docker 驗證與歷史資料驗收證據
- Stop condition: 所有計畫與驗收證據完成；或外部來源/環境連續阻塞且無法進展
- Non-goals:
- accounts, bookmarks, Redis, D1, Rust, server-side Chromium, runtime scraping
- Scope: docs/aegis/plans/2026-07-12-riftversus-mvp.md 的 13 個任務
- Change kinds:
- architecture
- Risk hints:
- 來源存取、歷史資料正確性、Docker WSL 整合與跨模組契約

## BaselineReadSetHint

- docs/aegis/specs/2026-07-12-riftversus-design.md
- docs/aegis/BASELINE-GOVERNANCE.md

## BaselineUsageDraft

- Required baseline refs:
- docs/aegis/specs/2026-07-12-riftversus-design.md
- docs/aegis/BASELINE-GOVERNANCE.md
- Acknowledged before plan:
- none
- Cited in plan:
- none
- Missing refs:
- docs/aegis/specs/2026-07-12-riftversus-design.md
- docs/aegis/BASELINE-GOVERNANCE.md
- Advisory decision: needs-baseline-readback

## ImpactStatementDraft

- Compatibility boundary: 同一 DATABASE_URL 與 S3 contract 支援 local/remote；failed sync 不取代已發布資料
- Affected layers:
- web, server, domain, database, sync, storage, Docker
- Owners:
- domain/database canonical facts; sync providers; server HTTP; web presentation
- Invariants:
- 公開結果只讀已發布 PostgreSQL canonical facts，API 不做 runtime scraping
- Non-goals:
- accounts, bookmarks, Redis, D1, Rust, server-side Chromium, runtime scraping

These records are Method Pack drafts / hints, not authoritative runtime decisions.
