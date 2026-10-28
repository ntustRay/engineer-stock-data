# engineer-stock-data

工程師選股網的資料快照專案。股票資料不進入會員資料庫；正式資料也不提交到 main。

## 狀態

目前提供上市／上櫃行情與低頻資料的候選正規化函式、授權門檻、資料合併與修正、保留規則、JSON Schema、快照一致性檢查及 orphan commit 發布函式。政府開放資料集的授權資訊已查證；**官方 JSON 回應及資料集對應、正式擷取、普通股名錄、交易日曆及停牌例外仍未完成驗證，正式發布和排程維持關閉。** 手動發布會明確失敗，`tests/fixtures/` 與 unit tests 只有虛構資料。

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run fixture
bun run schema
```

產出的 `staging/snapshot` 僅供本機測試。覆蓋率針對輸入的普通股名錄計算，尚未接上交易所正式名錄。正式發布前，應逐一核實 `config/sources.yml` 中候選 endpoint 的授權對應及實際 response，接入授權來源、交易日曆、名錄與停牌證據，完成正式抓取、快照讀取與會員環境設定，並以來源實際內容確認各欄位單位與日期。不可直接將測試 fixture 放到 data branch。

`publishSnapshot` 使用無 parent 的 commit 和帶期望舊 SHA 的 `--force-with-lease`；呼叫者必須提供**載入舊快照時**取得的 SHA，不能在準備推送時才重新取得，否則可能覆蓋並行更新。GitHub 仍可能暫存不可達 objects。不要以為資料可讀就可再散布。
