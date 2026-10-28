import { dateSchema } from './contracts.js';
export function dailyCutoff(asOfDate: string, days = 30): string {
  dateSchema.parse(asOfDate);
  if (!Number.isInteger(days) || days < 1) throw new Error('Invalid retention');
  const d = new Date(`${asOfDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}
export function retainDaily<T extends { date: string }>(
  items: T[],
  asOfDate: string,
): T[] {
  const cutoff = dailyCutoff(asOfDate);
  return items
    .filter(
      (x) =>
        dateSchema.safeParse(x.date).success &&
        x.date >= cutoff &&
        x.date <= asOfDate,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function retainCompleteMonths<T extends { period: string }>(
  items: T[],
  asOfDate: string,
  count = 36,
): T[] {
  dateSchema.parse(asOfDate);
  const end = asOfDate.slice(0, 7);
  const d = new Date(`${asOfDate.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - count);
  const start = d.toISOString().slice(0, 7);
  return items
    .filter(
      (x) =>
        /^\d{4}-(0[1-9]|1[0-2])$/.test(x.period) &&
        x.period >= start &&
        x.period < end,
    )
    .sort((a, b) => a.period.localeCompare(b.period));
}
export function retainLatest<T>(
  items: T[],
  key: (item: T) => string,
  count: number,
): T[] {
  if (!Number.isInteger(count) || count < 0)
    throw new Error('Invalid retention');
  return count === 0
    ? []
    : [...items].sort((a, b) => key(a).localeCompare(key(b))).slice(-count);
}
