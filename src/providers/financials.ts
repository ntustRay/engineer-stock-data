import { z } from 'zod/v4';
import { parseNumber, toTwd } from '../normalize.js';
import { quarterlySchema } from '../contracts.js';

export const financialRowsSchema = z
  .array(
    z.object({
      出表日期: z.string(),
      年度: z.string(),
      季別: z.string(),
      公司代號: z.string(),
      營業收入: z.string(),
      '營業毛利（毛損）淨額': z.string(),
      '營業利益（損失）': z.string(),
      '本期淨利（淨損）': z.string(),
      '基本每股盈餘（元）': z.string(),
    }),
  )
  .min(1);
const cumulativeSchema = z.object({
  flowBasis: z.literal('year_to_date'),
  revenue: z.number().nullable(),
  grossProfit: z.number().nullable(),
  operatingIncome: z.number().nullable(),
  netIncome: z.number().nullable(),
  eps: z.number().nullable(),
  grossMarginPct: z.number().nullable(),
  operatingMarginPct: z.number().nullable(),
});
export function normalizeFinancials(
  raw: unknown,
  source: string,
  prior: Map<string, z.infer<typeof quarterlySchema>[]>,
) {
  const seen = new Set<string>();
  return financialRowsSchema.parse(raw).map((row) => {
    const symbol = row.公司代號.trim();
    const year = Number(row.年度) + (Number(row.年度) < 1911 ? 1911 : 0);
    const quarter = Number(row.季別);
    if (!Number.isInteger(year) || ![1, 2, 3, 4].includes(quarter))
      throw new Error('Invalid financial period');
    const period = `${year}-Q${quarter}`;
    if (seen.has(`${symbol}:${period}`))
      throw new Error('Duplicate financial report');
    seen.add(`${symbol}:${period}`);
    const revenue = toTwd(parseNumber(row.營業收入), 'thousand_TWD');
    const grossProfit = toTwd(
      parseNumber(row['營業毛利（毛損）淨額']),
      'thousand_TWD',
    );
    const operatingIncome = toTwd(
      parseNumber(row['營業利益（損失）']),
      'thousand_TWD',
    );
    const netIncome = toTwd(
      parseNumber(row['本期淨利（淨損）']),
      'thousand_TWD',
    );
    const ratio = (n: number | null, d: number | null) =>
      n === null || d === null || d === 0 ? null : (n / d) * 100;
    const cumulative = {
      flowBasis: 'year_to_date' as const,
      revenue,
      grossProfit,
      operatingIncome,
      netIncome,
      eps: parseNumber(row['基本每股盈餘（元）']),
      grossMarginPct: ratio(grossProfit, revenue),
      operatingMarginPct: ratio(operatingIncome, revenue),
    };
    // A predecessor may only be used after the accounting basis has been established.
    // These bulk feeds do not identify that basis, so unknown metadata must not authorize subtraction.
    const previous = prior
      .get(symbol)
      ?.find(
        (r) =>
          r.period === `${year}-Q${quarter - 1}` &&
          r.source === source &&
          r.accountingBasis !== undefined,
      );
    const predecessor = cumulativeSchema.safeParse(previous?.cumulative);
    const single = (
      key: 'revenue' | 'grossProfit' | 'operatingIncome' | 'netIncome',
    ) => {
      const now = cumulative[key];
      if (quarter === 1) return now;
      const before = predecessor.success ? predecessor.data[key] : null;
      return now === null || before === null ? null : now - before;
    };
    const singleRevenue = single('revenue');
    const asOfDate = new Date(Date.UTC(year, quarter * 3, 0))
      .toISOString()
      .slice(0, 10);
    return {
      symbol,
      financial: quarterlySchema.parse({
        period,
        periodType: 'quarter',
        fiscalYear: year,
        fiscalQuarter: quarter,
        source,
        sourceUnit: 'thousand_TWD',
        currency: 'TWD',
        accountingStandard: 'IFRS',
        asOfDate,
        availableAt: null,
        cumulative,
        revenue: singleRevenue,
        grossProfit: single('grossProfit'),
        operatingIncome: single('operatingIncome'),
        netIncome: single('netIncome'),
        eps: quarter === 1 ? cumulative.eps : null,
        roePct: null,
        cashFlow: null,
        grossMarginPct: ratio(single('grossProfit'), singleRevenue),
        operatingMarginPct: ratio(single('operatingIncome'), singleRevenue),
        derivedFields:
          quarter > 1 && predecessor.success
            ? ['revenue', 'grossProfit', 'operatingIncome', 'netIncome']
            : [],
      }),
    };
  });
}
