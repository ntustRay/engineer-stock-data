import { z } from 'zod/v4';
import { parseDate, parseNumber } from '../normalize.js';
import type { Market } from './quotes.js';

export const twseValuationSchema = z
  .array(
    z.object({
      Date: z.string(),
      Code: z.string(),
      PEratio: z.string(),
      PBratio: z.string(),
      DividendYield: z.string(),
    }),
  )
  .min(1);
export const tpexValuationSchema = z
  .array(
    z.object({
      Date: z.string(),
      SecuritiesCompanyCode: z.string(),
      PriceEarningRatio: z.string(),
      PriceBookRatio: z.string(),
      YieldRatio: z.string(),
    }),
  )
  .min(1);
export function normalizeValuations(
  market: Market,
  raw: unknown,
  targetDate: string,
) {
  const rows =
    market === 'TWSE'
      ? twseValuationSchema.parse(raw)
      : tpexValuationSchema.parse(raw);
  const seen = new Set<string>();
  return rows.map((row) => {
    const twse = 'Code' in row;
    const symbol = (twse ? row.Code : row.SecuritiesCompanyCode).trim();
    const asOfDate = parseDate(row.Date);
    if (asOfDate !== targetDate)
      throw new Error('Valuation and price dates differ');
    if (seen.has(symbol)) throw new Error('Duplicate valuation');
    seen.add(symbol);
    return {
      symbol,
      asOfDate,
      per: parseNumber(twse ? row.PEratio : row.PriceEarningRatio),
      pbr: parseNumber(twse ? row.PBratio : row.PriceBookRatio),
      dividendYieldPct: parseNumber(twse ? row.DividendYield : row.YieldRatio),
    };
  });
}
