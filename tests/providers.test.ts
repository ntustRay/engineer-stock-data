import { describe, expect, it } from 'bun:test';
import {
  assertSameTradingDay,
  normalizeQuotes,
} from '../src/providers/quotes.js';
import { assembleQuoteSnapshot } from '../src/assemble.js';
import { createSnapshot } from '../src/snapshot.js';
import { collectQuoteSnapshot } from '../src/collect.js';
import { approvedFixture } from './support/approved-fixture.js';

// Synthetic rows exercise the documented field names; they are not official
// response fixtures and must not be used to approve a live source.
const twse = {
  Date: '1151027',
  Code: '9001',
  Name: '測試電子',
  OpeningPrice: '100',
  HighestPrice: '105',
  LowestPrice: '99',
  ClosingPrice: '103',
  TradeVolume: '150,000',
  TradeValue: '15,450,000',
  Change: '3',
};
const tpex = {
  Date: '1151027',
  SecuritiesCompanyCode: '9002',
  CompanyName: '測試科技',
  Open: '50',
  High: '52',
  Low: '49',
  Close: '51',
  TradingShares: '50,000',
  TransactionAmount: '2,550,000',
  Change: '1',
};

describe('market quote normalization', () => {
  it('normalizes both markets without converting shares into lots', () => {
    const listed = normalizeQuotes('TWSE', [twse]);
    const otc = normalizeQuotes('TPEX', [tpex]);
    expect(assertSameTradingDay([listed, otc])).toBe('2026-10-27');
    expect(listed.quotes[0].daily.volumeShares).toBe(150000);
    expect(listed.quotes[0].daily.changePct).toBe(3);
    expect(otc.quotes[0].daily.turnoverTwd).toBe(2550000);
  });
  it('rejects changed schemas, duplicate securities, and inconsistent dates', () => {
    expect(() =>
      normalizeQuotes('TWSE', [{ ...twse, OpeningPrice: undefined }]),
    ).toThrow();
    expect(() => normalizeQuotes('TWSE', [twse, twse])).toThrow(/Duplicate/);
    expect(() =>
      normalizeQuotes('TWSE', [
        twse,
        { ...twse, Code: '9003', Date: '1151026' },
      ]),
    ).toThrow(/Mixed dates/);
    expect(() =>
      assertSameTradingDay([
        normalizeQuotes('TWSE', [twse]),
        normalizeQuotes('TPEX', [{ ...tpex, Date: '1151026' }]),
      ]),
    ).toThrow(/dates/);
  });
  it('preserves unknowns and rejects invalid prices', () => {
    expect(
      normalizeQuotes('TWSE', [{ ...twse, Change: 'X' }]).quotes[0].daily
        .changePct,
    ).toBeNull();
    expect(() =>
      normalizeQuotes('TWSE', [{ ...twse, HighestPrice: '1' }]),
    ).toThrow();
  });
  it('uses a separately classified common-stock universe and validates coverage', () => {
    const batches = [
      normalizeQuotes('TWSE', [twse]),
      normalizeQuotes('TPEX', [tpex]),
    ];
    const universe = [
      {
        security: {
          securityId: 'TWSE:9001',
          symbol: '9001',
          market: 'TWSE' as const,
          name: '測試電子',
          industry: null,
          status: 'active' as const,
        },
        securityType: 'common_stock' as const,
        source: 'verified-universe',
      },
      {
        security: {
          securityId: 'TPEX:9002',
          symbol: '9002',
          market: 'TPEX' as const,
          name: '測試科技',
          industry: null,
          status: 'active' as const,
        },
        securityType: 'common_stock' as const,
        source: 'verified-universe',
      },
    ];
    const args = {
      snapshotId: '2026-10-27T12:00:00.000Z',
      targetDate: '2026-10-27',
      universe,
      batches,
      exceptions: [],
      previous: null,
    };
    expect(assembleQuoteSnapshot(args).stocks).toHaveLength(2);
    expect(
      createSnapshot(assembleQuoteSnapshot(args)).has('index/screener.json'),
    ).toBe(true);
    expect(() =>
      assembleQuoteSnapshot({ ...args, targetDate: '2026-10-28' }),
    ).toThrow(/expected trading date/);
    expect(() =>
      assembleQuoteSnapshot({
        ...args,
        universe: [
          ...universe,
          {
            ...universe[0],
            security: {
              ...universe[0].security,
              securityId: 'TWSE:9999',
              symbol: '9999',
            },
          },
        ],
      }),
    ).toThrow(/coverage/);
  });
  it('collects only approved sources with injected HTTP and fails closed on schema errors', async () => {
    const { input, registry } = approvedFixture();
    const universe = input.stocks.map((stock) => ({
      security: stock.security,
      securityType: 'common_stock' as const,
      source: `test.${stock.security.market}.securities`,
    }));
    const fetchImpl = async (input: string | URL | Request) =>
      new Response(
        JSON.stringify(String(input).includes('twse.com.tw') ? [twse] : [tpex]),
        { headers: { 'content-type': 'application/json' } },
      );
    const args = {
      snapshotId: input.snapshotId,
      targetDate: input.asOfDate,
      previous: null,
      registry,
      universe,
      exceptions: [],
      fetchOptions: { fetchImpl },
    };
    const result = await collectQuoteSnapshot(args);
    expect(result.stocks).toHaveLength(2);
    expect(result.sources).toHaveLength(4);
    const badFetch = async () =>
      new Response('[{}]', { headers: { 'content-type': 'application/json' } });
    await expect(
      collectQuoteSnapshot({ ...args, fetchOptions: { fetchImpl: badFetch } }),
    ).rejects.toThrow();
  });
});
