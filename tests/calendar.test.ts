import { describe, expect, it } from 'bun:test';
import {
  isJointTradingDay,
  isTradingDay,
  previousJointTradingDay,
  taipeiDate,
  type MarketCalendar,
} from '../src/calendar.js';

const calendar: MarketCalendar = {
  market: 'TWSE',
  validFrom: '2026-01-01',
  validUntil: '2026-12-31',
  source: 'synthetic',
  verifiedAt: '2026-01-01',
  closedDates: ['2026-02-16'],
  additionalTradingDates: ['2026-02-21'],
};
describe('verified trading calendar', () => {
  it('handles weekdays, closures and exceptional weekend sessions', () => {
    expect(isTradingDay(calendar, '2026-02-16')).toBe(false);
    expect(isTradingDay(calendar, '2026-02-21')).toBe(true);
    expect(isTradingDay(calendar, '2026-02-22')).toBe(false);
    expect(isTradingDay(calendar, '2026-02-23')).toBe(true);
  });
  it('fails outside its verified range or when markets disagree', () => {
    expect(() => isTradingDay(calendar, '2027-01-01')).toThrow(
      /does not cover/,
    );
    expect(() =>
      isJointTradingDay(
        [calendar, { ...calendar, market: 'TPEX', closedDates: [] }],
        '2026-02-16',
      ),
    ).toThrow(/disagree/);
    expect(
      isJointTradingDay(
        [calendar, { ...calendar, market: 'TPEX' }],
        '2026-02-16',
      ),
    ).toBe(false);
  });
  it('uses Taipei date instead of the runner timezone', () => {
    expect(taipeiDate(new Date('2026-10-27T16:00:00.000Z'))).toBe('2026-10-28');
  });
  it('finds the prior joint session across weekends, holidays and exceptional sessions', () => {
    const calendars: MarketCalendar[] = [
      calendar,
      { ...calendar, market: 'TPEX' },
    ];
    expect(previousJointTradingDay(calendars, '2026-02-17')).toBe('2026-02-13');
    expect(previousJointTradingDay(calendars, '2026-02-23')).toBe('2026-02-21');
    expect(() => previousJointTradingDay(calendars, '2026-01-01')).toThrow(
      /does not cover/,
    );
  });
});
