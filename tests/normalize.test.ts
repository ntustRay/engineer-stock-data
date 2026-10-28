import { describe, it, expect } from 'bun:test';
import {
  parseNumber,
  toShares,
  toTwd,
  parseDate,
  singleQuarter,
} from '../src/normalize.js';
import {
  dailyCutoff,
  retainCompleteMonths,
  retainLatest,
} from '../src/retention.js';
describe('normalization', () => {
  it('handles numbers and preserves missing values', () => {
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('---')).toBeNull();
    expect(parseNumber('0')).toBe(0);
    expect(() => parseNumber('1,2')).toThrow();
  });
  it('converts units and ROC dates', () => {
    expect(toShares(2, 'lots')).toBe(2000);
    expect(toTwd(2, 'million_TWD')).toBe(2000000);
    expect(parseDate('115/10/27')).toBe('2026-10-27');
    expect(() => parseDate('2026/02/30')).toThrow();
  });
  it('derives quarterly values only with a previous period', () => {
    expect(singleQuarter(35, 20, 2)).toEqual({ value: 15, derived: true });
    expect(singleQuarter(35, null, 2).value).toBeNull();
  });
  it('retains calendar days and complete months', () => {
    expect(dailyCutoff('2026-01-05')).toBe('2025-12-07');
    const months = [
      { period: '2023-10' },
      { period: '2026-09' },
      { period: '2026-10' },
    ];
    expect(
      retainCompleteMonths(months, '2026-10-28').map((x) => x.period),
    ).toEqual(['2023-10', '2026-09']);
    expect(retainLatest([1, 2, 3], String, 2)).toEqual([2, 3]);
  });
});
