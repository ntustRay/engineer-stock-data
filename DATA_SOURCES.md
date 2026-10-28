# 資料來源與授權核對

以下是 2026-10-28 查到的政府資料開放平臺資料集。各資料集列有「政府資料開放授權條款－第1版」；[條款](https://data.gov.tw/license)允許在遵守顯名等義務下重製、散布及公開傳輸。下表只記錄**資料集授權**，不等於已完成特定 JSON endpoint 的回應驗證及發布核准。

| 資料集 | 來源與授權依據 | 候選 JSON endpoint | 狀態 |
|---|---|---|---|
| 上市個股日成交 | [政府資料集 11549](https://data.gov.tw/dataset/11549) | [TWSE STOCK_DAY_ALL](https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL) | 待實測與核對 CSV／JSON 對應 |
| 上櫃股票行情 | [政府資料集 11370](https://data.gov.tw/dataset/11370) | [TPEx daily close quotes](https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes) | 待實測與核對 CSV／JSON 對應 |
| 集保股權分散 | [政府資料集 11452](https://data.gov.tw/dataset/11452) | [TDCC 1-5](https://openapi.tdcc.com.tw/v1/opendata/1-5) | 待實測與核對 CSV／JSON 對應 |
| 上市公司基本資料 | [政府資料集 18419](https://data.gov.tw/dataset/18419) | [TWSE OpenAPI](https://openapi.twse.com.tw/) | 待驗證證券種類與普通股名錄 |
| 上櫃公司基本資料 | [政府資料集 25036](https://data.gov.tw/dataset/25036) | [TPEx OpenAPI](https://www.tpex.org.tw/openapi/) | 待驗證證券種類與普通股名錄 |
| 上市個股估值 | [政府資料集 11547](https://data.gov.tw/dataset/11547) | [TWSE OpenAPI](https://openapi.twse.com.tw/) | 待實測欄位與日期 |
| 上櫃個股估值 | [政府資料集 11373](https://data.gov.tw/dataset/11373) | [TPEx OpenAPI](https://www.tpex.org.tw/openapi/) | 待實測欄位與日期 |
| 上市月營收 | [政府資料集 18420](https://data.gov.tw/dataset/18420) | [TWSE OpenAPI](https://openapi.twse.com.tw/) | 待確認單位及欄位 |
| 上櫃月營收 | [政府資料集 56510](https://data.gov.tw/dataset/56510) | [TPEx OpenAPI](https://www.tpex.org.tw/openapi/) | 待確認單位及欄位 |

資料集的提供機關是金融監督管理委員會證券期貨局，括號內為原資料供應者。正式發佈時須按條款標示提供機關／單位、年份、資料集名稱與版本、授權聲明和授權網址；`config/sources.yml` 記錄候選顯名文字。不同資料集須分別核對，不可將某資料集的授權推及另一資料集。

目前執行環境無法取得可靠的官方 JSON 完整回應，來源欄位 fixture 尚未驗證，普通股分類、交易日曆和停牌證據來源也尚未完成。`redistribution_approved` 仍維持 `false`，正式發布被程式及 Workflow 雙重關閉；unit test 的範例為合成資料。不得因具備授權頁就啟用未經核實的資料來源。
