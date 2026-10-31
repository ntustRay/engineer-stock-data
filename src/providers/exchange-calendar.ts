import { z } from 'zod/v4';
import type { MarketCalendar } from '../calendar.js';
import { parseDate } from '../normalize.js';

export const exchangeCalendarSchema = z
  .array(
    z.object({
      Name: z.string(),
      Date: z.string(),
      Description: z.string(),
    }),
  )
  .min(1);
export const verifiedCalendarSchema = z.object({
  year: z.number().int(),
  verifiedAt: z.string(),
  tpexReference: z.string().url(),
  closedDates: z.array(z.string()),
  additionalTradingDates: z.array(z.string()),
});
export function normalizeCalendars(
  raw: unknown,
  config: z.infer<typeof verifiedCalendarSchema>,
): MarketCalendar[] {
  const rows = exchangeCalendarSchema.parse(raw);
  const official = rows.map((row) => ({ ...row, date: parseDate(row.Date) }));
  const year = String(config.year);
  const current = official.filter((row) => row.date.startsWith(year));
  if (!current.length)
    throw new Error(
      `Official calendar no longer covers ${year}; review next year's calendar`,
    );
  const closed = current
    .filter((row) => !/開始交易日|最後交易日/.test(row.Name))
    .map((row) => row.date)
    .sort();
  if (JSON.stringify(closed) !== JSON.stringify([...config.closedDates].sort()))
    throw new Error(
      'Official holiday calendar changed; both exchanges must be reviewed',
    );
  return (['TWSE', 'TPEX'] as const).map((market) => ({
    market,
    validFrom: `${year}-01-01`,
    validUntil: `${year}-12-31`,
    source: 'twse.calendar',
    verifiedAt: config.verifiedAt,
    closedDates: closed,
    additionalTradingDates: config.additionalTradingDates,
  }));
}
