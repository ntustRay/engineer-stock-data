import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { inputSchema } from '../src/contracts.js';
import { mergeSnapshots } from '../src/merge.js';
import { createSnapshot, canonicalJson } from '../src/snapshot.js';
import { loadSnapshot } from '../src/load-snapshot.js';

const input = () =>
  inputSchema.parse(
    JSON.parse(readFileSync('tests/fixtures/snapshot.json', 'utf8')),
  );

describe('snapshot merge', () => {
  it('preserves semantic equality after published exceptions are loaded in their canonical order', () => {
    const next = input();
    next.marketExceptions = next.stocks.map((stock) => ({
      securityId: stock.security.securityId,
      asOfDate: next.asOfDate,
      reason: 'no_trade',
      source: 'test.quotes',
    }));
    for (const stock of next.stocks) {
      const day = stock.daily[0];
      day.open = null;
      day.high = null;
      day.low = null;
      day.close = null;
      day.volumeShares = 0;
    }
    const first = mergeSnapshots(null, next);
    const restored = loadSnapshot(createSnapshot(first, { fixture: true }));
    const repeated = mergeSnapshots(restored, next);
    expect(canonicalJson(repeated)).toBe(canonicalJson(restored));
  });
  it('upserts corrections and retains separate low-frequency histories', () => {
    const prior = input();
    prior.asOfDate = '2026-10-26';
    prior.stocks[0].daily[0].date = '2026-10-26';
    prior.stocks[1].daily[0].date = '2026-10-26';
    prior.stocks[0].financials = [{ period: '2026-Q2', eps: 2 }];
    prior.stocks[0].annualFinancials = [{ period: '2025', revenue: 1000 }];
    prior.stocks[0].revenues = [{ period: '2026-09', revenue: 50 }];
    prior.stocks[0].ownership = [{ asOfDate: '2026-10-23', levels: [] }];
    const next = input();
    next.stocks[0].revenues = [{ period: '2026-09', revenue: 55 }];
    const merged = mergeSnapshots(prior, next);
    const listed = merged.stocks.find(
      (stock) => stock.security.securityId === 'TWSE:9001',
    );
    if (!listed) throw new Error('Missing test security');
    expect(listed.daily.map((x) => x.date)).toEqual([
      '2026-10-26',
      '2026-10-27',
    ]);
    expect(listed.revenues[0].revenue).toBe(55);
    expect(listed.financials).toHaveLength(1);
    expect(listed.annualFinancials).toHaveLength(1);
    expect(listed.ownership).toHaveLength(1);
    expect(mergeSnapshots(merged, next)).toEqual(merged);
  });
  it('fails on missing securities, future data, duplicate keys, or a date regression', () => {
    const prior = input();
    const missing = input();
    missing.stocks.pop();
    expect(() => mergeSnapshots(prior, missing)).toThrow(/disappeared/);
    const future = input();
    future.stocks[0].daily[0].date = '2026-11-01';
    expect(() => mergeSnapshots(prior, future)).toThrow(/Future/);
    const dup = input();
    dup.stocks[0].daily.push(dup.stocks[0].daily[0]);
    expect(() => mergeSnapshots(prior, dup)).toThrow(/Duplicate/);
    const older = input();
    older.asOfDate = '2026-10-26';
    expect(() => mergeSnapshots(prior, older)).toThrow(/backwards/);
  });
});
