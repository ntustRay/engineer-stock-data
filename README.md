# engineer-stock-data

[工程師選股網](https://engineer-stock-web.vercel.app/)的官方資料 Pipeline。Bun + TypeScript + Zod + GitHub Actions；股票 JSON 發布在 `data` branch，會員資料獨立放在 Supabase。

## 執行

```sh
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run test
bun run fixture
bun run schema
bun run build --target-date 2026-10-30
bun run verify
```

`fixture` 只產生標記為測試的快照，禁止發布。`build` 實際抓官方資料但不 push；只接受來源現有日期，不假設 API 可回補任意歷史日。`publish` 供 Actions 執行，讀取原 `data` SHA、驗證快照，最後以無 parent commit 與 `--force-with-lease` 原子替換。

## 自動更新

- 週一至週五台北 19:10、22:10；來源日期與兩市場交易日曆不符時停止，不發布空快照。
- 每週日台北 10:10 驗證正式快照的 hashes、Schema、自然鍵、檔案索引與來源期間。
- 合併資料程式／設定至 main 也會觸發更新。可在 Actions 手動指定 `targetDate`；`forceRefresh` 控制相同內容是否重發。
- CI 執行 Biome、TypeScript、unit tests、fixture dry-run 和 JSON Schema 檢查，無 E2E。
- 行情／名錄／日曆為必要來源。低頻或次要來源暫時失敗時保留前一有效資料、標記 stale；必要來源失敗不修改 data SHA。
- 可選的 HMAC cache 通知未設定時，網站最多每 15 分鐘重新解析 data SHA。

## 資料範圍

已接兩市場普通股行情、估值、公司名錄、月營收、一般業財報、集保股權分散、上櫃法人／融資券及上市股利。2026-10-30 的首次快照為 1,986 檔普通股；實際 counts 以 manifest 為準。排除 ETF、ETN、權證與 TDR。

行情保留 30 個日曆天、月營收 36 個完整月份、財報 12 季／5 年、集保 52 週、股利 5 年。首次上線只發布 API 實際提供的期間，不以保留上限冒充已回補的歷史。

累計損益明確存於 `cumulative`；單季前期、會計編制或公告時間未取得時不推算。EPS TTM、ROE、現金流與無合法資料來源的欄位保留 null。來源、授權與限制見 [DATA_SOURCES.md](DATA_SOURCES.md)，公開契約見 [SCHEMA.md](SCHEMA.md)。

2026 年交易日曆已與 TPEx 年表核對；跨年度前須更新 `config/market-calendar.json`。不把公司從名錄消失直接當作下市，會停止發布並要求核實。

正式 JSON 不進 main；data 只保留一個可達 root commit。GitHub 可能暫存不可達 objects，不保證立即回收實體儲存。
