import { z } from 'zod/v4';
import { dateSchema, marketSchema } from './contracts.js';

const calendarSchema = z
  .object({
    market: marketSchema,
    validFrom: dateSchema,
    validUntil: dateSchema,
    source: z.string().min(1),
    verifiedAt: dateSchema,
    closedDates: z.array(dateSchema),
    additionalTradingDates: z.array(dateSchema),
  })
  .superRefine((calendar, ctx) => {
    if (calendar.validFrom > calendar.validUntil)
      ctx.addIssue({ code: 'custom', message: 'Invalid calendar period' });
    for (const dates of [
      calendar.closedDates,
      calendar.additionalTradingDates,
    ]) {
      if (new Set(dates).size !== dates.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate calendar date' });
      if (
        dates.some(
          (date) => date < calendar.validFrom || date > calendar.validUntil,
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Calendar date outside its coverage',
        });
    }
    if (
      calendar.additionalTradingDates.some((date) =>
        calendar.closedDates.includes(date),
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Conflicting trading day' });
  });
export type MarketCalendar = z.infer<typeof calendarSchema>;

/** A date outside verified calendar coverage must never be guessed. */
export function isTradingDay(input: MarketCalendar, date: string): boolean {
  const calendar = calendarSchema.parse(input);
  const day = dateSchema.parse(date);
  if (day < calendar.validFrom || day > calendar.validUntil)
    throw new Error(`Calendar does not cover ${day}`);
  if (calendar.closedDates.includes(day)) return false;
  if (calendar.additionalTradingDates.includes(day)) return true;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function isJointTradingDay(
  calendars: MarketCalendar[],
  date: string,
): boolean {
  if (
    calendars.length !== 2 ||
    new Set(calendars.map((calendar) => calendar.market)).size !== 2
  )
    throw new Error('Both exchange calendars are required');
  const [listed, otc] = calendars.map((calendar) =>
    isTradingDay(calendar, date),
  );
  if (listed !== otc) throw new Error('Exchange calendars disagree');
  return listed;
}

export function taipeiDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return dateSchema.parse(
    `${values.get('year')}-${values.get('month')}-${values.get('day')}`,
  );
}
