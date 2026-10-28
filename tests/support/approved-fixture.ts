import { readFileSync } from 'node:fs';
import { inputSchema, type Source } from '../../src/contracts.js';
import { createSnapshot } from '../../src/snapshot.js';

/** Fictional source registry and records for local unit tests only. */
export function approvedFixture(snapshotId = '2026-10-27T12:00:00.000Z') {
  const registry: Source[] = (['TWSE', 'TPEX'] as const).flatMap((market) =>
    ['daily_price', 'securities', 'trading_calendar'].map((category) => ({
      id: `test.${market}.${category}`,
      provider: market === 'TWSE' ? 'twse' : 'tpex',
      url: `https://${market === 'TWSE' ? 'openapi.twse.com.tw' : 'www.tpex.org.tw'}/test/${category}`,
      category,
      market,
      frequency: 'test',
      license_name: 'synthetic test license',
      license_url: 'https://example.com/license',
      redistribution_approved: true,
      attribution: 'fictional test data',
      schema_fixture: 'synthetic-test.json',
      last_verified_at: '2026-10-28',
    })),
  );
  const input = inputSchema.parse(
    JSON.parse(readFileSync('tests/fixtures/snapshot.json', 'utf8')),
  );
  input.snapshotId = snapshotId;
  input.sources = registry.map((source) => {
    if (!source.license_url || !source.attribution || !source.last_verified_at)
      throw new Error('Invalid test source');
    return {
      id: source.id,
      name: source.id,
      provider: source.provider,
      sourceUrl: source.url,
      licenseUrl: source.license_url,
      attribution: source.attribution,
      lastVerifiedAt: source.last_verified_at,
    };
  });
  for (const stock of input.stocks) {
    stock.latest = {
      per: null,
      pbr: null,
      dividendYieldPct: null,
      epsTtm: null,
      revenueYoyPct: null,
      roePct: null,
    };
    stock.latestProvenance = {};
    for (const day of stock.daily)
      day.institutionalNetShares = {
        foreign: null,
        investmentTrust: null,
        dealer: null,
      };
  }
  return { input, registry, files: createSnapshot(input) };
}
