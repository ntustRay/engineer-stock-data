import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod/v4';
import { sourceSchema, type SnapshotInput } from '../src/contracts.js';
import { collectProduction, QuoteReadinessError } from '../src/production.js';
import { verifiedCalendarsSchema } from '../src/providers/exchange-calendar.js';
import { normalizeFinancials } from '../src/providers/financials.js';
import { normalizeSecurities } from '../src/providers/securities.js';
import { normalizeQuotes } from '../src/providers/quotes.js';
import { normalizeMargin } from '../src/providers/chips.js';
import {
  normalizeDividends,
  dividendRowsSchema,
} from '../src/providers/dividends.js';
import { createSnapshot } from '../src/snapshot.js';
import { assertPublicationReady } from '../src/approval.js';
import { loadSnapshot } from '../src/load-snapshot.js';

const registry = z
  .object({ sources: z.array(sourceSchema) })
  .parse(parse(readFileSync('config/sources.yml', 'utf8'))).sources;
const calendar = verifiedCalendarsSchema.parse(
  JSON.parse(readFileSync('config/market-calendar.json', 'utf8')),
);
const now = new Date('2026-10-31T12:00:00.000Z');
const fixture = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));
const withDate = (body: unknown, date: string) =>
  z
    .array(z.record(z.string(), z.unknown()))
    .parse(body)
    .map((row) => ({ ...row, Date: date }));
const isQuoteUrl = (url: string) =>
  url.endsWith('/STOCK_DAY_ALL') ||
  url.endsWith('/tpex_mainboard_daily_close_quotes');
function requests(
  override: (url: string, body: unknown) => unknown = (_url, body) => body,
) {
  return {
    fetchImpl: async (input: string | URL | Request) => {
      const url = String(input);
      const source = registry.find((s) => s.url === url);
      if (!source?.schema_fixture)
        throw new Error('Unregistered fixture request');
      return new Response(
        JSON.stringify(override(url, fixture(source.schema_fixture))),
        { headers: { 'content-type': 'application/json' } },
      );
    },
    sleep: async () => {},
  };
}
const exchangeRows = (body: unknown) =>
  z.array(z.record(z.string(), z.string())).parse(body);
async function collectDay(
  date: string,
  previous: SnapshotInput | null,
  override: (url: string, body: unknown) => unknown = (_url, body) => body,
) {
  const input = await collectProduction({
    registry,
    calendar,
    previous,
    now: new Date(`${date}T12:00:00.000Z`),
    fetchOptions: requests((url, body) =>
      override(url, isQuoteUrl(url) ? withDate(body, date) : body),
    ),
  });
  if (!input) throw new Error('Expected trading-day snapshot');
  const files = createSnapshot(input);
  assertPublicationReady(files, registry);
  return loadSnapshot(files);
}
describe('official ingestion with fixed response fixtures', () => {
  it('keeps absent dividend decision dates unknown instead of blocking every other company', () => {
    const rows = dividendRowsSchema.parse(
      fixture('tests/fixtures/official/twse-dividends.json'),
    );
    expect(
      normalizeDividends(
        [{ ...rows[0], '董事會（擬議）股利分派日': '0' }],
        'twse.dividends',
        '2026-10-30',
      ),
    ).toEqual([]);
    expect(
      normalizeDividends(rows, 'twse.dividends', '2026-10-30').length,
    ).toBeGreaterThan(0);
  });
  it('assembles both markets, valuations, monthly revenue, cumulative financials, chips and BOM-prefixed ownership', async () => {
    const input = await collectProduction({
      registry,
      calendar,
      previous: null,
      now,
      fetchOptions: requests(),
    });
    expect(input?.asOfDate).toBe('2026-10-30');
    expect(input?.stocks).toHaveLength(4);
    if (!input) throw new Error('Expected snapshot');
    const files = createSnapshot(input);
    expect(() => assertPublicationReady(files, registry)).not.toThrow();
    const loaded = loadSnapshot(files);
    expect(loaded.freshDatasets).toEqual(input.freshDatasets);
    const stock = input.stocks.find(
      (s) => s.security.securityId === 'TWSE:1101',
    );
    expect(stock?.revenues[0].revenue).toBe(14321556000);
    expect(stock?.revenues[0].asOfDate).toBe('2026-09-30');
    expect(stock?.financials[0].revenue).toBeNull();
    expect(stock?.financials[0].cumulative?.revenue).toBe(71289957000);
    expect(stock?.ownership[0].levels.length).toBeGreaterThan(0);
    expect(stock?.latest.epsTtm).toBeNull();
  });
  it.each([
    '2026-11-02T15:59:59.000Z',
    '2026-11-02T16:00:00.000Z',
    '2026-11-02T22:45:00.000Z',
  ])(
    'uses the official quote date when a run starts at %s',
    async (startedAt) => {
      const input = await collectProduction({
        registry,
        calendar,
        previous: null,
        now: new Date(startedAt),
        fetchOptions: requests((url, body) =>
          isQuoteUrl(url) ? withDate(body, '1151102') : body,
        ),
      });
      expect(input?.asOfDate).toBe('2026-11-02');
      expect(
        input?.stocks.every((stock) => stock.daily[0].date === input.asOfDate),
      ).toBe(true);
      if (!input) throw new Error('Expected snapshot');
      expect(() =>
        assertPublicationReady(createSnapshot(input), registry),
      ).not.toThrow();
    },
  );
  it.each([
    ['2026-11-22T12:00:00.000Z', '1151120', '2026-11-20'],
    ['2026-12-31T22:45:00.000Z', '1151231', '2026-12-31'],
    ['2027-01-04T12:00:00.000Z', '1160104', '2027-01-04'],
  ])(
    'publishes approved quotes after the calendar feed rolls over at %s',
    async (startedAt, quoteDate, expected) => {
      const input = await collectProduction({
        registry,
        calendar,
        previous: null,
        now: new Date(startedAt),
        fetchOptions: requests((url, body) => {
          if (url.endsWith('/holidaySchedule'))
            return fixture('tests/fixtures/official/twse-calendar-2027.json');
          return isQuoteUrl(url) ? withDate(body, quoteDate) : body;
        }),
      });
      expect(input?.asOfDate).toBe(expected);
      if (!input) throw new Error('Expected snapshot');
      expect(() =>
        assertPublicationReady(createSnapshot(input), registry),
      ).not.toThrow();
    },
  );
  it('still rejects unreviewed dates and live holiday changes', async () => {
    const input = {
      registry,
      calendar,
      previous: null,
      now: new Date('2027-01-04T12:00:00.000Z'),
    };
    const calendarFixture = fixture(
      'tests/fixtures/official/twse-calendar-2027.json',
    );
    await expect(
      collectProduction({
        ...input,
        calendar: calendar.filter(({ year }) => year === 2026),
        targetDate: '2027-01-04',
        fetchOptions: requests((url, body) =>
          url.endsWith('/holidaySchedule') ? calendarFixture : body,
        ),
      }),
    ).rejects.toThrow('Calendar does not cover 2027-01-04');
    const changed = z.array(z.unknown()).parse(calendarFixture).slice(0, -1);
    await expect(
      collectProduction({
        ...input,
        fetchOptions: requests((url, body) =>
          url.endsWith('/holidaySchedule') ? changed : body,
        ),
      }),
    ).rejects.toThrow('Official holiday calendar changed for 2027');
  });
  it.each([
    ['115/11/18', true],
    ['115/11/23', false],
    ['115/10/29', false],
  ])(
    'uses a delisting only when it took effect between snapshots: %s',
    async (effectiveDate, isDelisted) => {
      const previous = await collectProduction({
        registry,
        calendar,
        previous: null,
        now,
        fetchOptions: requests(),
      });
      if (!previous) throw new Error('Expected previous snapshot');
      const collecting = collectProduction({
        registry,
        calendar,
        previous,
        now: new Date('2026-11-23T02:30:00.000Z'),
        fetchOptions: requests((url, body) => {
          if (isQuoteUrl(url)) return withDate(body, '1151120');
          if (url.endsWith('/t187ap03_L'))
            return z.array(z.unknown()).parse(body).slice(0, 1);
          if (url.endsWith('/suspendListingCsvAndHtml'))
            return [
              { Code: '1102', DelistingDate: effectiveDate },
              { Code: '1101', DelistingDate: '115/11/18' },
            ];
          return body;
        }),
      });
      const result = await collecting;
      if (!result) throw new Error('Expected next snapshot');
      const delisted = result.stocks.find(
        ({ security }) => security.securityId === 'TWSE:1102',
      );
      expect(delisted?.security.status).toBe(
        isDelisted ? 'delisted' : 'active',
      );
      expect(delisted?.listing?.missingAfter).toBe(
        isDelisted ? null : previous.asOfDate,
      );
      expect(delisted?.daily.map(({ date }) => date)).toEqual(['2026-10-30']);
      expect(
        result.stocks.find(
          ({ security }) => security.securityId === 'TWSE:1101',
        )?.security.status,
      ).toBe('active');
      expect(result.sources.map(({ id }) => id)).toContain('twse.delistings');
      expect(() =>
        assertPublicationReady(createSnapshot(result), registry),
      ).not.toThrow();
    },
  );
  it('uses the quote date to exclude a listing that starts on the following day', async () => {
    const input = await collectProduction({
      registry,
      calendar,
      previous: null,
      now: new Date('2026-11-02T22:45:00.000Z'),
      fetchOptions: requests((url, body) => {
        if (isQuoteUrl(url)) return withDate(body, '1151102');
        if (!url.endsWith('/t187ap03_L')) return body;
        const rows = z.array(z.record(z.string(), z.unknown())).parse(body);
        return [
          ...rows,
          { ...rows[0], 公司代號: '1103', 上市日期: '20261103' },
        ];
      }),
    });
    expect(input?.asOfDate).toBe('2026-11-02');
    expect(input?.stocks).toHaveLength(4);
  });
  it.each([
    ['TWSE', 'ClosingPrice', null],
    ['TWSE', 'TradeVolume', 'pending'],
    ['TWSE', 'LowestPrice', '99999'],
    ['TPEX', 'TradingShares', null],
    ['TPEX', 'Close', '--'],
    ['TPEX', 'High', '1'],
    ['TWSE', 'Change', '--'],
    ['TPEX', 'Change', '--'],
  ] as const)(
    'handles first-day %s field %s=%s through publication',
    async (market, field, value) => {
      const prefix = market.toLowerCase();
      const getUrl = (kind: string) =>
        registry.find((s) => s.id === `${prefix}.${kind}`)?.url;
      const code = market === 'TWSE' ? 'Code' : 'SecuritiesCompanyCode';
      const first = await collectDay('2026-11-02', null, (url, body) => {
        if (url === getUrl('securities')) {
          const rows = exchangeRows(body);
          const symbolField = market === 'TWSE' ? '公司代號' : code;
          const dateField = market === 'TWSE' ? '上市日期' : 'DateOfListing';
          return [
            ...rows,
            { ...rows[0], [symbolField]: '5555', [dateField]: '20261102' },
          ];
        }
        if (url === getUrl('daily_price')) {
          const rows = exchangeRows(body);
          return [{ ...rows[0], [code]: '5555', [field]: value }, ...rows];
        }
        return body;
      });
      const id = `${market}:5555`;
      const stock = first.stocks.find((s) => s.security.securityId === id);
      expect(stock?.daily.length).toBe(field === 'Change' ? 1 : 0);
      expect(
        first.marketExceptions.some((item) => item.securityId === id),
      ).toBe(false);
      expect(
        first.stocks.filter(
          (s) =>
            s.security.securityId !== id && s.daily[0]?.date === first.asOfDate,
        ),
      ).toHaveLength(4);
      expect(first.sources.some((s) => s.id === `${prefix}.daily_price`)).toBe(
        true,
      );
    },
  );
  it('keeps date, duplicate and established-company validation strict when an IPO quote is malformed', () => {
    const [first, second] = exchangeRows(
      fixture('tests/fixtures/official/twse-quotes.json'),
    );
    const listingDates = new Map([
      [`TWSE:${first.Code}`, '2026-10-30'],
      [`TWSE:${second.Code}`, '2000-01-01'],
    ]);
    const bad = { ...first, ClosingPrice: null };
    const parse = (...rows: unknown[]) =>
      normalizeQuotes('TWSE', rows, listingDates);
    expect(() => parse(bad)).toThrow(/No TWSE quote date/);
    expect(() => parse(bad, first, second)).toThrow(/Duplicate/);
    expect(() => parse(bad, { ...second, Date: '1151029' })).toThrow(
      /Mixed dates/,
    );
    expect(() => parse({ ...bad, Date: 'bad' }, second)).toThrow(
      /Invalid date/,
    );
    expect(() => parse(first, { ...second, ClosingPrice: null })).toThrow();
    expect(() => parse({ ...bad, Date: '1151029' })).toThrow();
  });
  it('publishes a first-day listing without a quote and accepts its later first trade', async () => {
    const addMaster = (url: string, body: unknown) => {
      if (!url.endsWith('/t187ap03_L')) return body;
      const rows = exchangeRows(body);
      return [...rows, { ...rows[0], 公司代號: '1103', 上市日期: '20261102' }];
    };
    const first = await collectDay('2026-11-02', null, addMaster);
    const id = 'TWSE:1103';
    expect(
      first.stocks.find((s) => s.security.securityId === id)?.daily,
    ).toEqual([]);
    expect(first.marketExceptions.some((s) => s.securityId === id)).toBe(false);
    const screener = JSON.parse(
      createSnapshot(first).get('index/screener.json') ?? '{}',
    );
    expect(
      screener.data.find((s: { securityId: string }) => s.securityId === id),
    ).toMatchObject({ close: null, asOfDate: null });
    const next = await collectDay('2026-11-03', first, (url, body) => {
      if (!url.endsWith('/STOCK_DAY_ALL')) return addMaster(url, body);
      const rows = exchangeRows(body);
      return [...rows, { ...rows[0], Code: '1103' }];
    });
    expect(
      next.stocks
        .find((s) => s.security.securityId === id)
        ?.daily.map((d) => d.date),
    ).toEqual(['2026-11-03']);
  });
  it('keeps the last confirmed date across snapshots for late, missing or malformed delisting evidence', async () => {
    const initial = await collectDay('2026-10-30', null);
    // Simulate a snapshot written before the optional listing fields existed.
    for (const stock of initial.stocks) delete stock.listing;
    const without = (url: string, body: unknown) =>
      url.endsWith('/t187ap03_L') ? exchangeRows(body).slice(0, 1) : body;
    const pending = await collectDay('2026-11-02', initial, (url, body) =>
      url.endsWith('/suspendListingCsvAndHtml') ? [] : without(url, body),
    );
    const retained = (s: SnapshotInput) =>
      s.stocks.find((x) => x.security.securityId === 'TWSE:1102');
    expect(retained(pending)?.listing?.missingAfter).toBe('2026-10-30');
    const next = await collectDay('2026-11-03', pending, (url, body) =>
      url.endsWith('/suspendListingCsvAndHtml')
        ? [
            { Code: '1102', Company: '前發行人', DelistingDate: '115/11/02' },
            { Code: '1102', Company: '亞泥', DelistingDate: '?' },
          ]
        : without(url, body),
    );
    expect(retained(next)?.security.status).toBe('active');
    const retired = await collectDay('2026-11-04', next, (url, body) =>
      url.endsWith('/suspendListingCsvAndHtml')
        ? [null, { Code: '1102', Company: '亞泥', DelistingDate: '115/11/02' }]
        : without(url, body),
    );
    expect(retained(retired)?.security.status).toBe('delisted');
    expect(retained(retired)?.daily).toEqual(retained(initial)?.daily);
    const restored = await collectDay('2026-11-04', next);
    expect(retained(restored)?.listing?.missingAfter).toBeNull();
    expect(retained(restored)?.daily.map((d) => d.date)).toEqual([
      '2026-10-30',
      '2026-11-04',
    ]);
  });
  it.each([
    ['TWSE', 'TPEX', '1102', true],
    ['TPEX', 'TWSE', '1259', true],
    ['TPEX', 'TWSE', '1259', false],
  ] as const)(
    'reconciles %s to %s code %s with issuer match %s',
    async (origin, target, symbol, sameIssuer) => {
      const isMaster = (url: string, market: string) =>
        url.endsWith(market === 'TWSE' ? '/t187ap03_L' : '/mopsfin_t187ap03_O');
      const key = (market: string) =>
        market === 'TWSE' ? '公司代號' : 'SecuritiesCompanyCode';
      const identity = (market: string) =>
        market === 'TWSE' ? '營利事業統一編號' : 'UnifiedBusinessNo.';
      const initial = await collectDay('2026-10-30', null, (url, body) =>
        isMaster(url, origin)
          ? exchangeRows(body).map((row) => ({
              ...row,
              [identity(origin)]: '12345678',
            }))
          : body,
      );
      const next = await collectDay('2026-11-02', initial, (url, body) => {
        if (isMaster(url, origin))
          return exchangeRows(body).filter(
            (row) => row[key(origin)] !== symbol,
          );
        if (isMaster(url, target)) {
          const rows = exchangeRows(body);
          return [
            ...rows,
            {
              ...rows[0],
              [key(target)]: symbol,
              [target === 'TWSE' ? '上市日期' : 'DateOfListing']: '20261102',
              [identity(target)]: sameIssuer ? '12345678' : '87654321',
            },
          ];
        }
        if (
          url.endsWith(
            target === 'TWSE'
              ? '/STOCK_DAY_ALL'
              : '/tpex_mainboard_daily_close_quotes',
          )
        ) {
          const rows = exchangeRows(body);
          return [
            ...rows,
            {
              ...rows[0],
              [target === 'TWSE' ? 'Code' : 'SecuritiesCompanyCode']: symbol,
            },
          ];
        }
        return body;
      });
      const previousListing = next.stocks.find(
        (s) => s.security.securityId === `${origin}:${symbol}`,
      );
      expect(previousListing?.security.status).toBe(
        sameIssuer ? 'delisted' : 'active',
      );
      expect(previousListing?.listing?.missingAfter).toBe(
        sameIssuer ? null : initial.asOfDate,
      );
      expect(previousListing?.daily.map((d) => d.date)).toEqual([
        initial.asOfDate,
      ]);
      expect(
        next.stocks
          .find((s) => s.security.securityId === `${target}:${symbol}`)
          ?.daily.map((d) => d.date),
      ).toEqual([next.asOfDate]);
    },
  );
  it.each([true, false])(
    'confirms an overlapping market transfer only if old-market trading stopped: %s',
    async (stopped) => {
      const source = (date: string) => (url: string, body: unknown) => {
        const master = url.endsWith('/mopsfin_t187ap03_O');
        if (master) {
          return exchangeRows(body)
            .filter(
              (row) =>
                !(
                  date === '2026-11-03' && row.SecuritiesCompanyCode === '1259'
                ),
            )
            .map((row) => ({ ...row, 'UnifiedBusinessNo.': '12345678' }));
        }
        if (date === '2026-10-30') return body;
        if (url.endsWith('/t187ap03_L')) {
          const rows = exchangeRows(body);
          return [
            ...rows,
            {
              ...rows[0],
              公司代號: '1259',
              上市日期: '20261102',
              營利事業統一編號: '12345678',
            },
          ];
        }
        if (url.endsWith('/STOCK_DAY_ALL')) {
          const rows = exchangeRows(body);
          return [...rows, { ...rows[0], Code: '1259' }];
        }
        if (url.endsWith('/tpex_mainboard_daily_close_quotes') && stopped)
          return exchangeRows(body).map((row) =>
            row.SecuritiesCompanyCode === '1259'
              ? { ...row, Close: '---', TradingShares: '0' }
              : row,
          );
        return body;
      };
      const first = await collectDay('2026-10-30', null, source('2026-10-30'));
      const overlap = await collectDay(
        '2026-11-02',
        first,
        source('2026-11-02'),
      );
      const after = await collectDay(
        '2026-11-03',
        overlap,
        source('2026-11-03'),
      );
      expect(
        after.stocks.find((stock) => stock.security.securityId === 'TPEX:1259')
          ?.security.status,
      ).toBe(stopped ? 'delisted' : 'active');
    },
  );
  it('isolates reassigned codes from old prices, financials, and valuation carry-forward', async () => {
    const master =
      (issuer: string, listedAt: string) => (url: string, body: unknown) =>
        url.endsWith('/t187ap03_L')
          ? exchangeRows(body).map((row) =>
              row.公司代號 === '1101'
                ? { ...row, 營利事業統一編號: issuer, 上市日期: listedAt }
                : row,
            )
          : body;
    const former = await collectDay(
      '2026-10-30',
      null,
      master('12345678', '19620209'),
    );
    const find = (input: SnapshotInput) =>
      input.stocks.find((s) => s.security.securityId === 'TWSE:1101');
    expect(find(former)?.financials.length).toBeGreaterThan(0);
    expect(find(former)?.latest.pbr).not.toBeNull();
    const next = await collectDay(
      '2026-11-02',
      former,
      master('87654321', '20261102'),
    );
    const again = await collectDay(
      '2026-11-03',
      next,
      master('87654321', '20261102'),
    );
    for (const snapshot of [next, again]) {
      const stock = find(snapshot);
      expect(stock?.daily[0].date).toBe('2026-11-02');
      expect(stock?.listing?.issuerChangedAt).toBe('2026-11-02');
      expect(stock?.latest.pbr).toBeNull();
      expect(stock?.financials).toEqual([]);
      expect(stock?.revenues).toEqual([]);
      expect(stock?.dividends).toEqual([]);
      expect(stock?.ownership).toEqual([]);
    }
    const oldListing = find(former);
    if (!oldListing) throw new Error('Expected original listing');
    oldListing.security.status = 'delisted';
    delete oldListing.listing;
    const relisted = await collectDay(
      '2026-11-02',
      former,
      master('87654321', '20261102'),
    );
    expect(find(relisted)?.daily.map((day) => day.date)).toEqual([
      '2026-11-02',
    ]);
    expect(find(relisted)?.financials).toEqual([]);
  });
  it('quarantines one invalid official listing and accepts unavailable optional issuer IDs', async () => {
    const initial = await collectDay('2026-10-30', null);
    const next = await collectDay('2026-11-02', initial, (url, body) => {
      if (!url.endsWith('/t187ap03_L')) return body;
      return exchangeRows(body).map((row) =>
        row.公司代號 === '1102'
          ? { ...row, 上市日期: '未定' }
          : { ...row, 營利事業統一編號: null },
      );
    });
    expect(
      next.stocks.find((s) => s.security.securityId === 'TWSE:1102')?.listing
        ?.missingAfter,
    ).toBe('2026-10-30');
    expect(
      next.stocks
        .find((s) => s.security.securityId === 'TWSE:1101')
        ?.daily.at(-1)?.date,
    ).toBe('2026-11-02');
    const restored = await collectDay('2026-11-03', next);
    expect(
      restored.stocks.find((s) => s.security.securityId === 'TWSE:1102')
        ?.listing?.missingAfter,
    ).toBeNull();
    const rows = exchangeRows(
      fixture('tests/fixtures/official/twse-securities.json'),
    );
    expect(() =>
      normalizeSecurities(
        'TWSE',
        rows.map((row) => ({ ...row, 上市日期: '' })),
        '2026-11-02',
      ),
    ).toThrow('Too many invalid TWSE company rows');
  });
  it('blocks a truncated roster even when earlier unresolved listings exist', async () => {
    const previous = await collectDay('2026-10-30', null);
    const sample = previous.stocks.find((s) => s.security.market === 'TPEX');
    if (!sample) throw new Error('Expected TPEX fixture');
    for (const symbol of ['8011', '8012', '8013'])
      previous.stocks.push({
        ...sample,
        listing: sample.listing && { ...sample.listing },
        security: { ...sample.security, symbol, securityId: `TPEX:${symbol}` },
      });
    await expect(collectDay('2026-11-02', previous)).rejects.toThrow(
      'Unexpected TPEX roster loss',
    );
    for (const s of previous.stocks)
      if (s.security.symbol.startsWith('80') && s.listing)
        s.listing.missingAfter = '2026-10-29';
    const result = await collectDay('2026-11-02', previous);
    expect(result.stocks).toHaveLength(7);
  });
  it('keeps an explicit target date strict instead of substituting older quotes', async () => {
    await expect(
      collectProduction({
        registry,
        calendar,
        previous: null,
        now: new Date('2026-11-02T22:45:00.000Z'),
        targetDate: '2026-11-03',
        fetchOptions: requests((url, body) =>
          isQuoteUrl(url) ? withDate(body, '1151102') : body,
        ),
      }),
    ).rejects.toThrow('Official quotes are not ready for 2026-11-03');
  });
  it('re-fetches both markets when their dates temporarily disagree', async () => {
    let listedReads = 0;
    let otcReads = 0;
    const delays: number[] = [];
    const input = await collectProduction({
      registry,
      calendar,
      previous: null,
      now,
      fetchOptions: {
        ...requests((url, body) => {
          if (url.endsWith('/STOCK_DAY_ALL')) listedReads++;
          if (url.endsWith('/tpex_mainboard_daily_close_quotes')) {
            otcReads++;
            if (otcReads === 1) return withDate(body, '1151029');
          }
          return body;
        }),
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    });
    expect(input?.asOfDate).toBe('2026-10-30');
    expect([listedReads, otcReads]).toEqual([2, 2]);
    expect(delays).toEqual([30000]);
  });
  it('stops after bounded retries when quote dates still disagree', async () => {
    let otcReads = 0;
    const delays: number[] = [];
    await expect(
      collectProduction({
        registry,
        calendar,
        previous: null,
        now,
        fetchOptions: {
          ...requests((url, body) => {
            if (!url.endsWith('/tpex_mainboard_daily_close_quotes'))
              return body;
            otcReads++;
            return withDate(body, '1151029');
          }),
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      }),
    ).rejects.toBeInstanceOf(QuoteReadinessError);
    expect(otcReads).toBe(3);
    expect(delays).toEqual([30000, 30000]);
  });
  it('keeps future and non-adjacent market mismatches as hard failures', async () => {
    for (const date of ['1151102', '1151027']) {
      const result = collectProduction({
        registry,
        calendar,
        previous: null,
        now,
        fetchOptions: requests((url, body) =>
          url.endsWith('/tpex_mainboard_daily_close_quotes')
            ? withDate(body, date)
            : body,
        ),
      });
      await expect(result).rejects.toThrow(/quote dates do not match/);
      await expect(result).rejects.not.toBeInstanceOf(QuoteReadinessError);
    }
  });
  it.each([
    ['1151029', /quotes are stale/],
    ['1151102', /future trading date/],
    ['1151031', /non-trading date/],
  ])('rejects invalid automatic quote date %s', async (date, error) => {
    await expect(
      collectProduction({
        registry,
        calendar,
        previous: null,
        now,
        fetchOptions: requests((url, body) =>
          isQuoteUrl(url) ? withDate(body, date) : body,
        ),
      }),
    ).rejects.toThrow(error);
  });
  it('fails a missing required quote schema and skips explicit non-trading dates', async () => {
    await expect(
      collectProduction({
        registry,
        calendar,
        previous: null,
        now,
        fetchOptions: requests((url, body) =>
          url.includes('STOCK_DAY_ALL') ? [{ changed: true }] : body,
        ),
      }),
    ).rejects.toThrow();
    expect(
      await collectProduction({
        registry,
        calendar,
        previous: null,
        now,
        targetDate: '2026-10-31',
        fetchOptions: requests(),
      }),
    ).toBeNull();
  });
  it('does not attach valuation or institutional data from another trading date', async () => {
    const input = await collectProduction({
      registry,
      calendar,
      previous: null,
      now,
      fetchOptions: requests((url, body) => {
        if (
          !url.includes('peratio_analysis') &&
          !url.includes('3insti_daily_trading')
        )
          return body;
        return z
          .array(z.record(z.string(), z.unknown()))
          .parse(body)
          .map((row) => ({ ...row, Date: '1151029' }));
      }),
    });
    expect(input?.freshDatasets).not.toContain('tpex.valuation');
    expect(input?.freshDatasets).not.toContain('tpex.institutional');
    expect(
      input?.stocks.find((s) => s.security.market === 'TPEX')?.latest.per,
    ).toBeNull();
  });
  it('excludes exchange-classified TDRs and does not subtract cumulative EPS', () => {
    const row = {
      出表日期: '1151030',
      公司代號: '9103',
      公司簡稱: '測試-DR',
      產業別: '91',
      上市日期: '20030101',
    };
    expect(normalizeSecurities('TWSE', [row], '2026-10-30')).toEqual([]);
    const financials = normalizeFinancials(
      fixture('tests/fixtures/official/twse-income.json'),
      'twse.financial',
      new Map(),
    );
    expect(financials[0].financial.eps).toBeNull();
    expect(financials[0].financial.availableAt).toBeNull();
  });
  it('converts margin trading units to shares rather than applying quote-volume units', () => {
    const rows = normalizeMargin(
      [
        {
          Date: '1151030',
          SecuritiesCompanyCode: '1240',
          MarginPurchaseBalance: '12',
          MarginPurchaseBalancePreviousDay: '10',
          ShortSaleBalance: '3',
          ShortSaleBalancePreviousDay: '4',
        },
      ],
      '2026-10-30',
    );
    expect(rows[0].margin.marginBalanceShares).toBe(12000);
    expect(rows[0].margin.shortChangeShares).toBe(-1000);
  });
});
