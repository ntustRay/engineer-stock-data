/** Missing markers stay null. Invalid non-empty values are rejected instead of silently coerced. */
export function parseNumber(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid number');
    return input;
  }
  if (typeof input !== 'string') throw new Error('Invalid number type');
  const value = input.trim();
  if (!value || ['--', '---', '—', 'N/A', '不適用'].includes(value))
    return null;
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(value))
    throw new Error(`Invalid numeric text: ${value}`);
  const result = Number(value.replaceAll(',', ''));
  if (!Number.isFinite(result)) throw new Error('Invalid number');
  return result;
}
export function toTwd(
  value: number | null,
  unit: 'TWD' | 'thousand_TWD' | 'million_TWD',
): number | null {
  if (value === null) return null;
  const multiplier = { TWD: 1, thousand_TWD: 1000, million_TWD: 1000000 }[unit];
  const result = value * multiplier;
  if (
    !Number.isSafeInteger(result) &&
    Math.abs(result) > Number.MAX_SAFE_INTEGER
  )
    throw new Error('Amount exceeds safe range');
  return result;
}
export function toShares(
  value: number | null,
  unit: 'shares' | 'lots',
): number | null {
  if (value === null) return null;
  const result = value * (unit === 'lots' ? 1000 : 1);
  if (!Number.isSafeInteger(result)) throw new Error('Invalid share count');
  return result;
}
export function parseDate(input: string): string {
  const parts = input.trim().split(/[/-]/);
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p)))
    throw new Error('Invalid date');
  let [year, month, day] = parts.map(Number);
  if (year < 1911) year += 1911;
  const formatted = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${formatted}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== formatted
  )
    throw new Error('Invalid date');
  return formatted;
}
export function singleQuarter(
  current: number | null,
  previousCumulative: number | null,
  quarter: 1 | 2 | 3 | 4,
): { value: number | null; derived: boolean } {
  if (current === null) return { value: null, derived: false };
  if (quarter === 1) return { value: current, derived: false };
  return previousCumulative === null
    ? { value: null, derived: false }
    : { value: current - previousCumulative, derived: true };
}
