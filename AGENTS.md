# AGENTS.md

- Bun／TypeScript 資料 Pipeline 產生工程師選股網的公開 JSON。資料契約見 [SCHEMA.md](SCHEMA.md)，官方來源、單位與授權見 [DATA_SOURCES.md](DATA_SOURCES.md) 和 `config/sources.yml`。
- 合併上市與上櫃行情前核對交易日。缺公告時間、前期資料或合法來源的欄位依契約保留 `null`。必要來源驗證失敗時保留前一份正式快照。
- 開發驗證用 `bun run check`、`bun run typecheck`、`bun test tests`、`bun run fixture` 及 `bun run schema`。Schema 變更後一併檢查 `schemas/` 的輸出。
- 測試 fixture 留在測試流程。正式資料透過既有 GitHub Actions 發布到 `data` branch。
