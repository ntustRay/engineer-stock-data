import { z } from 'zod/v4';
import { dividendSchema } from '../contracts.js';
import { parseDate, parseNumber } from '../normalize.js';

export const dividendRowsSchema = z
  .array(
    z.object({
      出表日期: z.string(),
      公司代號: z.string(),
      股利年度: z.string(),
      股利所屬期間: z.string(),
      期別: z.string(),
      '決議（擬議）進度': z.string(),
      '董事會（擬議）股利分派日': z.string(),
      '股東配發-盈餘分配之現金股利(元/股)': z.string(),
      '股東配發-法定盈餘公積發放之現金(元/股)': z.string(),
      '股東配發-資本公積發放之現金(元/股)': z.string(),
      '股東配發-盈餘轉增資配股(元/股)': z.string(),
      '股東配發-法定盈餘公積轉增資配股(元/股)': z.string(),
      '股東配發-資本公積轉增資配股(元/股)': z.string(),
    }),
  )
  .min(1);
export function normalizeDividends(
  raw: unknown,
  source: string,
  targetDate: string,
) {
  const byDeclaration = new Map<
    string,
    z.infer<typeof dividendRowsSchema>[number]
  >();
  for (const row of dividendRowsSchema.parse(raw)) {
    // Proposed distributions are not treated as confirmed dividends.
    if (row['決議（擬議）進度'].includes('擬議')) continue;
    if (['', '0', '-', '--'].includes(row['董事會（擬議）股利分派日'].trim()))
      continue;
    const asOfDate = parseDate(row['董事會（擬議）股利分派日']);
    if (asOfDate > targetDate) continue;
    const key = `${row.公司代號}:${row.股利年度}:${row.股利所屬期間}:${row.期別}`;
    if (byDeclaration.has(key))
      throw new Error('Duplicate dividend declaration');
    byDeclaration.set(key, row);
  }
  type Declaration = {
    asOfDate: string;
    cashDividend: number | null;
    stockDividend: number | null;
    status: string;
  };
  const grouped = new Map<
    string,
    { symbol: string; period: string; declarations: Declaration[] }
  >();
  const sum = (values: (number | null)[]) =>
    values.some((v) => v === null)
      ? null
      : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  for (const row of byDeclaration.values()) {
    const year =
      Number(row.股利年度) + (Number(row.股利年度) < 1911 ? 1911 : 0);
    if (!Number.isInteger(year)) throw new Error('Invalid dividend year');
    const symbol = row.公司代號.trim(),
      period = String(year),
      key = `${symbol}:${period}`;
    const item = grouped.get(key) ?? { symbol, period, declarations: [] };
    item.declarations.push({
      asOfDate: parseDate(row['董事會（擬議）股利分派日']),
      cashDividend: sum(
        [
          row['股東配發-盈餘分配之現金股利(元/股)'],
          row['股東配發-法定盈餘公積發放之現金(元/股)'],
          row['股東配發-資本公積發放之現金(元/股)'],
        ].map(parseNumber),
      ),
      stockDividend: sum(
        [
          row['股東配發-盈餘轉增資配股(元/股)'],
          row['股東配發-法定盈餘公積轉增資配股(元/股)'],
          row['股東配發-資本公積轉增資配股(元/股)'],
        ].map(parseNumber),
      ),
      status: row['決議（擬議）進度'],
    });
    grouped.set(key, item);
  }
  return [...grouped.values()].map(({ symbol, period, declarations }) => ({
    symbol,
    dividend: dividendSchema.parse({
      period,
      source,
      sourceUnit: 'TWD_per_share',
      availableAt: null,
      asOfDate: declarations
        .map((d) => d.asOfDate)
        .sort()
        .at(-1),
      cashDividend: sum(declarations.map((d) => d.cashDividend)),
      stockDividend: sum(declarations.map((d) => d.stockDividend)),
      exDividendDate: null,
      exRightsDate: null,
      declarations,
    }),
  }));
}
