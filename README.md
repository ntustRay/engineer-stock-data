# engineer-stock-data

工程師選股網的資料快照專案。股票資料不進入會員資料庫；正式資料也不提交到 main。

## 狀態

目前提供資料契約、授權門檻、30 個日曆天保留、輸入資料完整性檢查、fixture snapshot 與 orphan commit 發布函式。**官方來源尚未完成授權驗證、正式抓取、正規化、交易日曆、低頻歷史合併與增量修正，排程尚未啟用，手動執行會明確失敗而不發布任何資料。** `tests/fixtures/` 只有虛構資料，不可當作正式行情。

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run fixture
```

產出的 `staging/snapshot` 僅供本機測試。覆蓋率目前只針對輸入名錄計算，尚未與交易所正式名錄比對。正式發布前，應逐一核實 `config/sources.yml` 的授權與來源 fixture，完成 TWSE/TPEx provider、單位轉換及實際日期驗證、99% 覆蓋率及停牌例外、舊快照合併、schema 與 cross-file contract tests，再由 GitHub Actions 以最小權限執行發布。不可直接將測試 fixture 放到 data branch。

`publishSnapshot` 使用無 parent 的 commit 和帶期望舊 SHA 的 `--force-with-lease`；GitHub 仍可能暫存不可達 objects。不要以為資料可讀就可再散布。
