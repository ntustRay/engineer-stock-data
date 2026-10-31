# 資料來源

2026-10-31 已實測下列官方 JSON response，核對政府資料開放平臺各資料集與 OpenAPI 說明。授權採[政府資料開放授權條款－第1版](https://data.gov.tw/license)。`config/sources.yml` 保存逐項授權、顯名、來源 URL、fixture 與查核日期。

| 資料集 | ID | 官方 API | 授權依據 |
|---|---|---|---|
| 上市個股日成交資訊 | `twse.daily_price` | [來源](https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL) | [授權資料集](https://data.gov.tw/dataset/11549) |
| 上櫃股票行情 | `tpex.daily_price` | [來源](https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes) | [授權資料集](https://data.gov.tw/dataset/11370) |
| 上市公司基本資料 | `twse.securities` | [來源](https://openapi.twse.com.tw/v1/opendata/t187ap03_L) | [授權資料集](https://data.gov.tw/dataset/18419) |
| 上櫃公司基本資料 | `tpex.securities` | [來源](https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O) | [授權資料集](https://data.gov.tw/dataset/25036) |
| 有價證券集中交易市場開（休）市日期 | `twse.calendar` | [來源](https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule) | [授權資料集](https://data.gov.tw/dataset/11761) |
| 上市個股本益比、殖利率及股價淨值比 | `twse.valuation` | [來源](https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL) | [授權資料集](https://data.gov.tw/dataset/11547) |
| 上櫃股票個股本益比、殖利率、股價淨值比 | `tpex.valuation` | [來源](https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis) | [授權資料集](https://data.gov.tw/dataset/11373) |
| 上市公司每月營業收入彙總表 | `twse.revenue` | [來源](https://openapi.twse.com.tw/v1/opendata/t187ap05_L) | [授權資料集](https://data.gov.tw/dataset/18420) |
| 上櫃公司每月營業收入彙總表 | `tpex.revenue` | [來源](https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O) | [授權資料集](https://data.gov.tw/dataset/56510) |
| 集保戶股權分散表 | `tdcc.distribution` | [來源](https://openapi.tdcc.com.tw/v1/opendata/1-5) | [授權資料集](https://data.gov.tw/dataset/11452) |
| 上市公司綜合損益表（一般業） | `twse.financial` | [來源](https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci) | [授權資料集](https://data.gov.tw/dataset/91998) |
| 上櫃公司財報資訊（一般業） | `tpex.financial` | [來源](https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_ciA) | [授權資料集](https://data.gov.tw/dataset/94865) |
| 上櫃股票三大法人買賣明細資訊 | `tpex.institutional` | [來源](https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading) | [授權資料集](https://data.gov.tw/dataset/11856) |
| 上櫃股票融資融券餘額 | `tpex.margin` | [來源](https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance) | [授權資料集](https://data.gov.tw/dataset/11387) |
| 上市公司股利分派情形 | `twse.dividends` | [來源](https://openapi.twse.com.tw/v1/opendata/t187ap45_L) | [授權資料集](https://data.gov.tw/dataset/31612) |

- 名錄使用兩市場公司基本資料；排除產業代碼 91 的 TDR、未到上市日期的公司。ETF、ETN、權證不在普通股名錄。
- 休市日依 TWSE 官方年表，2026 年已與[TPEx 年表](https://www.tpex.org.tw/storage/eb_data/11411/114007545811-1.pdf)核對。超出已核對年度或官方年表異動時停止發布。
- 行情無收盤價標記只證明沒有一般交易收盤價，可能仍有零股成交；保留原成交股數並登錄 no_trade 來源證據。不把沒有回傳的股票當成停牌。
- 行情量為股；上櫃融資券原單位為千股，轉為股。單位依 TPEx 收市資訊格式 S23 核對。月營收與損益表金額原單位為千元，轉為新台幣元。
- 財報提供年初至當季累計值，放入 cumulative.flowBasis=year_to_date；缺前期與會計編制依據時，單季欄位為 null。EPS 不用累計值相減或冒充 TTM。
- availableAt 缺原公告時間時維持 null；出表日不當成公告時間。不提供歷史回測。
- 上市法人明細尚無已確認可公開再散布的來源；上市融資券 OpenAPI 缺資料日期，不與行情合併。上櫃股利舊 endpoint 僅回傳過時資料，未啟用。
- 上市股利將同年度已決議的不同期別合計；排除擬議與缺決議日期者，不推算未公告配息。除權息日期無來源時為 null。
- 首次啟用只保有官方 API 實際提供的歷史。保留上限不代表已回補 30 日／36 月／12 季／5 年／52 週。
