import { z } from 'zod/v4';
import { revenueSchema, symbolSchema } from '../contracts.js';
import { parseNumber, toTwd } from '../normalize.js';

const value = z.union([z.string(), z.number()]);
export const revenueRowsSchema = z
  .array(
    z.object({
      資料年月: value,
      公司代號: z.string(),
      '營業收入-當月營收': value,
      '營業收入-上月比較增減(%)': value,
      '營業收入-去年同月增減(%)': value,
      '累計營業收入-當月累計營收': value,
      '累計營業收入-前期比較增減(%)': value,
    }),
  )
  .min(1);

function period(input: string): string {
  const value = input.trim();
  if (!/^\d{5,6}$/.test(value)) throw new Error('Invalid revenue period');
  const month = Number(value.slice(-2));
  let year = Number(value.slice(0, -2));
  if (year < 1911) year += 1911;
  if (month < 1 || month > 12) throw new Error('Invalid revenue month');
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** The monetary source unit must be verified per source; never assume one. */
export function normalizeRevenue(
  input: unknown,
  source: string,
  sourceUnit: 'TWD' | 'thousand_TWD' | 'million_TWD',
) {
  if (!source) throw new Error('Revenue source is required');
  const seen = new Set<string>();
  return revenueRowsSchema
    .parse(input)
    .map((row) => {
      const symbol = symbolSchema.parse(row.公司代號.trim());
      const month = period(String(row.資料年月));
      const key = `${symbol}:${month}`;
      if (seen.has(key)) throw new Error('Duplicate monthly revenue');
      seen.add(key);
      return {
        symbol,
        revenue: revenueSchema.parse({
          period: month,
          revenue: toTwd(parseNumber(row['營業收入-當月營收']), sourceUnit),
          momPct: parseNumber(row['營業收入-上月比較增減(%)']),
          yoyPct: parseNumber(row['營業收入-去年同月增減(%)']),
          cumulativeRevenue: toTwd(
            parseNumber(row['累計營業收入-當月累計營收']),
            sourceUnit,
          ),
          cumulativeYoyPct: parseNumber(row['累計營業收入-前期比較增減(%)']),
          source,
          sourceUnit,
          asOfDate: new Date(
            Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
          )
            .toISOString()
            .slice(0, 10),
          // The report date is not necessarily the original announcement time.
          availableAt: null,
        }),
      };
    })
    .sort(
      (a, b) =>
        a.symbol.localeCompare(b.symbol) ||
        a.revenue.period.localeCompare(b.revenue.period),
    );
}
