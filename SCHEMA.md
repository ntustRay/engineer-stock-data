# Snapshot v1

`schemas/1.0.0/` 包含由 `src/published.ts` 產生的 JSON Schema。修改公開契約後執行 `bun run schema`，並依語意化版本處理相容性。JSON Schema 無法表達所有跨欄位和跨檔案規則；執行時仍必須通過 Zod、自然鍵、日期、覆蓋率、SHA-256 與快照一致性驗證。

`manifest.json` 提供快照識別、實際交易日、資料集狀態、來源／授權顯名及檔案 hash。`index/screener.json` 是選股投影；`stocks/{market}/{symbol}.json` 是近 30 個日曆天的個股 read model。市場與代號是複合識別，股票代號一律為字串。

單位：價格與金額為新台幣元，成交量及籌碼為股，EPS 為元／股，百分比以 `12.5` 表示 12.5%。未知值是 `null`，不得以零取代。季度、年度、月營收與持股分布各自保存期間與來源資訊；沒有來源公告時間時 `availableAt` 為 `null`，不可供歷史回測。

季度最多 12 季、年度最多 5 年、月營收保留最近 36 個完整月份、集保保留最近 52 筆週資料、股利最多 5 年。資料已提供但本次未完成來源刷新時標為 `stale`；缺資料為 `unavailable`。測試資料和候選來源 adapter 不構成正式資料授權或可用性驗證。
