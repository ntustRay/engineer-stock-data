import { z } from 'zod/v4';
import type { MarketCalendar } from '../calendar.js';
import { dateSchema } from '../contracts.js';
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
export const verifiedCalendarsSchema = z
  .array(
    z.object({
      year: z.number().int().min(1912).max(9999),
      verifiedAt: dateSchema,
      tpexReference: z.string().url(),
      closedDates: z.array(dateSchema),
      additionalTradingDates: z.array(dateSchema),
    }),
  )
  .min(1)
  .refine(
    (reviews) =>
      new Set(reviews.map(({ year }) => year)).size === reviews.length,
    'Duplicate reviewed calendar year',
  );

export function normalizeCalendars(
  raw: unknown,
  reviews: z.infer<typeof verifiedCalendarsSchema>,
): MarketCalendar[] {
  const rows = exchangeCalendarSchema.parse(raw);
  const official = rows.map((row) => ({ ...row, date: parseDate(row.Date) }));
  const newestOfficialYear = Math.max(
    ...official.map(({ date }) => Number(date.slice(0, 4))),
  );
  return reviews
    .filter(({ year }) => year <= newestOfficialYear)
    .flatMap(({ year, verifiedAt, closedDates, additionalTradingDates }) => {
      const current = official.filter((row) => row.date.startsWith(`${year}-`));
      // Once TWSE publishes a later year, the replaced year keeps its reviewed dates.
      if (current.length) {
        const liveClosedDates = current
          .filter((row) => !/開始交易日|最後交易日/.test(row.Name))
          .map((row) => row.date)
          .sort();
        if (
          JSON.stringify(liveClosedDates) !==
          JSON.stringify([...closedDates].sort())
        )
          throw new Error(
            `Official holiday calendar changed for ${year}; both exchanges must be reviewed`,
          );
      }
      return (['TWSE', 'TPEX'] as const).map((market) => ({
        market,
        validFrom: `${year}-01-01`,
        validUntil: `${year}-12-31`,
        source: 'twse.calendar',
        verifiedAt,
        closedDates,
        additionalTradingDates,
      }));
    });
}
