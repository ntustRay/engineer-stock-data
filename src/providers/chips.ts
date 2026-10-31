import { z } from 'zod/v4';
import { parseDate, parseNumber, toShares } from '../normalize.js';

export const institutionalRowsSchema = z
  .array(
    z.object({
      Date: z.string(),
      SecuritiesCompanyCode: z.string(),
      'Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference':
        z.string(),
      'SecuritiesInvestmentTrustCompanies-Difference': z.string(),
      'Dealers-Difference': z.string(),
    }),
  )
  .min(1);
export const marginRowsSchema = z
  .array(
    z.object({
      Date: z.string(),
      SecuritiesCompanyCode: z.string(),
      MarginPurchaseBalance: z.string(),
      MarginPurchaseBalancePreviousDay: z.string(),
      ShortSaleBalance: z.string(),
      ShortSaleBalancePreviousDay: z.string(),
    }),
  )
  .min(1);
export function normalizeInstitutional(raw: unknown, targetDate: string) {
  return institutionalRowsSchema.parse(raw).map((row) => {
    if (parseDate(row.Date) !== targetDate)
      throw new Error('Institutional and price dates differ');
    return {
      symbol: row.SecuritiesCompanyCode.trim(),
      institutionalNetShares: {
        foreign: toShares(
          parseNumber(
            row[
              'Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference'
            ],
          ),
          'shares',
        ),
        investmentTrust: toShares(
          parseNumber(row['SecuritiesInvestmentTrustCompanies-Difference']),
          'shares',
        ),
        dealer: toShares(parseNumber(row['Dealers-Difference']), 'shares'),
      },
    };
  });
}
export function normalizeMargin(raw: unknown, targetDate: string) {
  return marginRowsSchema.parse(raw).map((row) => {
    const asOfDate = parseDate(row.Date);
    if (asOfDate !== targetDate)
      throw new Error('Margin and price dates differ');
    // The official margin balances are in trading units (1,000 shares), unlike quote volume.
    const margin = toShares(parseNumber(row.MarginPurchaseBalance), 'lots');
    const previousMargin = toShares(
      parseNumber(row.MarginPurchaseBalancePreviousDay),
      'lots',
    );
    const short = toShares(parseNumber(row.ShortSaleBalance), 'lots');
    const previousShort = toShares(
      parseNumber(row.ShortSaleBalancePreviousDay),
      'lots',
    );
    return {
      symbol: row.SecuritiesCompanyCode.trim(),
      margin: {
        asOfDate,
        marginBalanceShares: margin,
        marginChangeShares:
          margin === null || previousMargin === null
            ? null
            : margin - previousMargin,
        shortBalanceShares: short,
        shortChangeShares:
          short === null || previousShort === null
            ? null
            : short - previousShort,
      },
    };
  });
}
