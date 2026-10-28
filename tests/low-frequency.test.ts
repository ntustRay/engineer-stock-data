import { describe, expect, it } from 'bun:test';
import { normalizeOwnership } from '../src/providers/ownership.js';
import { normalizeRevenue } from '../src/providers/revenue.js';
import { readFileSync } from 'node:fs';
import { inputSchema } from '../src/contracts.js';
import { applyLowFrequencyUpdates } from '../src/low-frequency.js';

const revenue = {
  資料年月: '11509',
  公司代號: '9001',
  '營業收入-當月營收': '1,234',
  '營業收入-上月比較增減(%)': '5',
  '營業收入-去年同月增減(%)': '--',
  '累計營業收入-當月累計營收': '9,999',
  '累計營業收入-前期比較增減(%)': '2',
};
const ownership = {
  資料日期: '20261023',
  證券代號: '9001 ',
  持股分級: '1',
  人數: '10',
  股數: '1,000',
  '占集保庫存數比例%': '0.1',
};

describe('low-frequency normalization', () => {
  it('converts revenue using the explicitly supplied unit and does not invent an announcement time', () => {
    const result = normalizeRevenue([revenue], 'test', 'thousand_TWD')[0]
      .revenue;
    expect(result.period).toBe('2026-09');
    expect(result.revenue).toBe(1234000);
    expect(result.yoyPct).toBeNull();
    expect(result.availableAt).toBeNull();
    expect(() => normalizeRevenue([revenue, revenue], 'test', 'TWD')).toThrow(
      /Duplicate/,
    );
  });
  it('groups ownership by date and symbol and rejects duplicated levels', () => {
    const result = normalizeOwnership([ownership], 'test')[0];
    expect(result.symbol).toBe('9001');
    expect(result.ownership.asOfDate).toBe('2026-10-23');
    expect(result.ownership.levels[0].shares).toBe(1000);
    expect(() => normalizeOwnership([ownership, ownership], 'test')).toThrow(
      /Duplicate/,
    );
  });
  it('applies a monthly correction while preserving unrelated histories', () => {
    const prior = inputSchema.parse(
      JSON.parse(readFileSync('tests/fixtures/snapshot.json', 'utf8')),
    );
    prior.stocks[0].financials = [{ period: '2026-Q2', eps: 2 }];
    prior.stocks[0].revenues = [{ period: '2026-09', revenue: 100 }];
    const updated = applyLowFrequencyUpdates(
      prior,
      '2026-10-27T13:00:00.000Z',
      [
        {
          securityId: 'TWSE:9001',
          revenues: [
            normalizeRevenue([revenue], 'test', 'thousand_TWD')[0].revenue,
          ],
        },
      ],
    );
    const stock = updated.stocks.find(
      (item) => item.security.securityId === 'TWSE:9001',
    );
    if (!stock) throw new Error('Missing test security');
    expect(stock.revenues).toHaveLength(1);
    expect(stock.revenues[0].revenue).toBe(1234000);
    expect(stock.financials).toHaveLength(1);
    expect(stock.daily).toHaveLength(1);
    expect(() =>
      applyLowFrequencyUpdates(prior, prior.snapshotId, [
        { securityId: 'TWSE:9999' },
      ]),
    ).toThrow(/Unknown/);
  });
});
