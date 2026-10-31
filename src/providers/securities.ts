import { z } from 'zod/v4';
import { securitySchema } from '../contracts.js';
import { parseDate } from '../normalize.js';
import type { Market } from './quotes.js';

export const twseSecuritiesSchema = z
  .array(
    z.object({
      出表日期: z.string(),
      公司代號: z.string(),
      公司簡稱: z.string(),
      產業別: z.string(),
      上市日期: z.string(),
    }),
  )
  .min(1);
export const tpexSecuritiesSchema = z
  .array(
    z.object({
      Date: z.string(),
      SecuritiesCompanyCode: z.string(),
      CompanyAbbreviation: z.string(),
      SecuritiesIndustryCode: z.string(),
      DateOfListing: z.string(),
    }),
  )
  .min(1);
const industries: Record<string, string> = {
  '01': '水泥工業',
  '02': '食品工業',
  '03': '塑膠工業',
  '04': '紡織纖維',
  '05': '電機機械',
  '06': '電器電纜',
  '07': '化學生技醫療',
  '08': '玻璃陶瓷',
  '09': '造紙工業',
  '10': '鋼鐵工業',
  '11': '橡膠工業',
  '12': '汽車工業',
  '14': '建材營造',
  '15': '航運業',
  '16': '觀光餐旅',
  '17': '金融保險',
  '18': '貿易百貨',
  '19': '綜合',
  '20': '其他',
  '21': '化學工業',
  '22': '生技醫療',
  '23': '油電燃氣',
  '24': '半導體業',
  '25': '電腦及週邊設備',
  '26': '光電業',
  '27': '通信網路業',
  '28': '電子零組件業',
  '29': '電子通路業',
  '30': '資訊服務業',
  '31': '其他電子業',
  '32': '文化創意業',
  '33': '農業科技',
  '34': '電子商務',
  '35': '綠能環保',
  '36': '數位雲端',
  '37': '運動休閒',
  '38': '居家生活',
};
export function normalizeSecurities(
  market: Market,
  raw: unknown,
  targetDate: string,
) {
  const rows =
    market === 'TWSE'
      ? twseSecuritiesSchema.parse(raw)
      : tpexSecuritiesSchema.parse(raw);
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const twse = '公司代號' in row;
    const symbol = (twse ? row.公司代號 : row.SecuritiesCompanyCode).trim();
    const industry = (twse ? row.產業別 : row.SecuritiesIndustryCode).trim();
    // Industry 91 is the exchange's TDR classification. Company masters do not include ETFs/warrants.
    if (industry === '91') return [];
    if (!/^\d{4}$/.test(symbol))
      throw new Error(`Unrecognized common-stock code: ${symbol}`);
    if (seen.has(symbol))
      throw new Error(`Duplicate ${market} company ${symbol}`);
    seen.add(symbol);
    const listedAt = parseDate(twse ? row.上市日期 : row.DateOfListing);
    if (listedAt > targetDate) return [];
    return [
      {
        security: securitySchema.parse({
          securityId: `${market}:${symbol}`,
          market,
          symbol,
          name: (twse ? row.公司簡稱 : row.CompanyAbbreviation).trim(),
          industry: industries[industry] ?? `產業 ${industry}`,
          status: 'active',
        }),
        securityType: 'common_stock' as const,
        source: `${market.toLowerCase()}.securities`,
      },
    ];
  });
}
