import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod/v4';
import { sourceSchema } from '../src/contracts.js';
import { collectProduction } from '../src/production.js';
import { verifiedCalendarSchema } from '../src/providers/exchange-calendar.js';
import { normalizeFinancials } from '../src/providers/financials.js';
import { normalizeSecurities } from '../src/providers/securities.js';
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
const calendar = verifiedCalendarSchema.parse(
  JSON.parse(readFileSync('config/market-calendar.json', 'utf8')),
);
const now = new Date('2026-10-31T12:00:00.000Z');
const fixture = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));
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
