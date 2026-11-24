import { z } from 'zod/v4';
import { securitySchema } from '../contracts.js';
import { parseDate } from '../normalize.js';
import type { Market } from './quotes.js';

export const companyListSchema = z.array(z.unknown()).min(1);
const issuerField = z.string().nullish().catch(null);
const twseSecurityRow = z.object({
  出表日期: z.string(),
  公司代號: z.string(),
  公司簡稱: z.string(),
  產業別: z.string(),
  上市日期: z.string(),
  營利事業統一編號: issuerField,
});
const tpexSecurityRow = z.object({
  Date: z.string(),
  SecuritiesCompanyCode: z.string(),
  CompanyAbbreviation: z.string(),
  SecuritiesIndustryCode: z.string(),
  DateOfListing: z.string(),
  'UnifiedBusinessNo.': issuerField,
});
const delistingRow = z.object({
  DelistingDate: z.string(),
  Company: z.string().nullish(),
  Code: z.string(),
});
export const twseDelistingsSchema = companyListSchema.transform((rows) =>
  rows.flatMap((row) => {
    const result = delistingRow.safeParse(row);
    if (result.success) return [result.data];
    console.warn(
      JSON.stringify({ stage: 'delisting-evidence', status: 'invalid-row' }),
    );
    return [];
  }),
);
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
  const rows = companyListSchema.parse(raw);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const malformed: string[] = [];
  const result = rows.flatMap((rawRow) => {
    const parsed = (
      market === 'TWSE' ? twseSecurityRow : tpexSecurityRow
    ).safeParse(rawRow);
    if (!parsed.success) {
      malformed.push(
        parsed.error.issues.map((issue) => issue.path.join('.')).join(','),
      );
      return [];
    }
    const row = parsed.data;
    const twse = '公司代號' in row;
    const symbol = (twse ? row.公司代號 : row.SecuritiesCompanyCode).trim();
    const industry = (twse ? row.產業別 : row.SecuritiesIndustryCode).trim();
    // Industry 91 is the exchange's TDR classification. Company masters do not include ETFs/warrants.
    if (industry === '91') return [];
    const name = (twse ? row.公司簡稱 : row.CompanyAbbreviation).trim();
    if (!/^\d{4}$/.test(symbol) || !name || !industry) {
      malformed.push(symbol);
      return [];
    }
    if (seen.has(symbol)) {
      duplicates.add(symbol);
      malformed.push(symbol);
      return [];
    }
    seen.add(symbol);
    let listedAt: string;
    try {
      listedAt = parseDate(twse ? row.上市日期 : row.DateOfListing);
    } catch {
      malformed.push(symbol);
      return [];
    }
    if (listedAt > targetDate) return [];
    const issuer = (
      twse ? row.營利事業統一編號 : row['UnifiedBusinessNo.']
    )?.trim();
    return [
      {
        listing: {
          issuerId: issuer && /^\d{8}$/.test(issuer) ? issuer : null,
          listedAt,
          missingAfter: null,
        },
        security: securitySchema.parse({
          securityId: `${market}:${symbol}`,
          market,
          symbol,
          name,
          industry: industries[industry] ?? `產業 ${industry}`,
          status: 'active',
        }),
        securityType: 'common_stock' as const,
        source: `${market.toLowerCase()}.securities`,
      },
    ];
  });
  const unambiguous = result.filter(
    (item) => !duplicates.has(item.security.symbol),
  );
  if (malformed.length) {
    console.warn(
      JSON.stringify({
        stage: 'listing-master',
        market,
        status: 'invalid-rows',
        count: malformed.length,
        sample: malformed.slice(0, 5),
      }),
    );
    if (
      !unambiguous.length ||
      malformed.length > Math.max(1, Math.floor(rows.length * 0.01))
    )
      throw new Error(
        `Too many invalid ${market} company rows: ${malformed.length}/${rows.length}`,
      );
  }
  return unambiguous;
}
