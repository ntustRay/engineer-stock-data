import { z } from 'zod/v4';
import { ownershipSchema, symbolSchema } from '../contracts.js';
import { parseDate, parseNumber, toShares } from '../normalize.js';

const value = z.union([z.string(), z.number()]);
const rowsSchema = z
  .array(
    z.object({
      資料日期: value,
      證券代號: z.string(),
      持股分級: value,
      人數: value,
      股數: value,
      '占集保庫存數比例%': value,
    }),
  )
  .min(1);

/** Candidate TDCC mapping; production activation still requires live schema verification. */
export function normalizeOwnership(input: unknown, source: string) {
  if (!source) throw new Error('Ownership source is required');
  const grouped = new Map<
    string,
    {
      symbol: string;
      asOfDate: string;
      levels: z.infer<typeof ownershipSchema>['levels'];
    }
  >();
  for (const row of rowsSchema.parse(input)) {
    const symbol = symbolSchema.parse(row.證券代號.trim());
    const asOfDate = parseDate(String(row.資料日期));
    const level = String(row.持股分級).trim();
    if (!/^(?:[1-9]|1[0-7])$/.test(level))
      throw new Error('Invalid ownership level');
    const key = `${symbol}:${asOfDate}`;
    const record = grouped.get(key) ?? { symbol, asOfDate, levels: [] };
    if (record.levels.some((item) => item.level === level))
      throw new Error('Duplicate ownership level');
    record.levels.push({
      level,
      holders: toShares(parseNumber(row.人數), 'shares'),
      shares: toShares(parseNumber(row.股數), 'shares'),
      percentage: parseNumber(row['占集保庫存數比例%']),
    });
    grouped.set(key, record);
  }
  return [...grouped.values()]
    .map(({ symbol, ...record }) => ({
      symbol,
      ownership: ownershipSchema.parse({
        ...record,
        source,
        levels: record.levels.sort((a, b) => Number(a.level) - Number(b.level)),
      }),
    }))
    .sort(
      (a, b) =>
        a.symbol.localeCompare(b.symbol) ||
        a.ownership.asOfDate.localeCompare(b.ownership.asOfDate),
    );
}
