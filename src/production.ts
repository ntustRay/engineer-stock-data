import { z } from 'zod/v4';
import { inputSchema, type SnapshotInput, type Source } from './contracts.js';
import { fetchApprovedJson, type FetchOptions } from './fetch.js';
import { assembleQuoteSnapshot } from './assemble.js';
import { isJointTradingDay, taipeiDate } from './calendar.js';
import {
  normalizeQuotes,
  twseQuotesSchema,
  tpexQuotesSchema,
  assertSameTradingDay,
} from './providers/quotes.js';
import {
  normalizeSecurities,
  twseSecuritiesSchema,
  tpexSecuritiesSchema,
} from './providers/securities.js';
import {
  normalizeCalendars,
  exchangeCalendarSchema,
  type verifiedCalendarSchema,
} from './providers/exchange-calendar.js';
import {
  normalizeValuations,
  twseValuationSchema,
  tpexValuationSchema,
} from './providers/valuation.js';
import { normalizeRevenue, revenueRowsSchema } from './providers/revenue.js';
import { normalizeOwnership } from './providers/ownership.js';
import {
  normalizeFinancials,
  financialRowsSchema,
} from './providers/financials.js';
import { mergeSnapshots } from './merge.js';
import {
  institutionalRowsSchema,
  marginRowsSchema,
  normalizeInstitutional,
  normalizeMargin,
} from './providers/chips.js';
import {
  dividendRowsSchema,
  normalizeDividends,
} from './providers/dividends.js';
import { annualSchema } from './contracts.js';

const objectRows = z.array(z.record(z.string(), z.unknown())).min(1);
const sourceMetadata = (source: Source) => {
  if (!source.license_url || !source.attribution || !source.last_verified_at)
    throw new Error('Incomplete source provenance');
  return {
    id: source.id,
    name: source.name ?? source.id,
    provider: source.provider,
    sourceUrl: source.url,
    licenseUrl: source.license_url,
    attribution: source.attribution,
    lastVerifiedAt: source.last_verified_at,
  };
};
export async function collectProduction(args: {
  registry: Source[];
  calendar: z.infer<typeof verifiedCalendarSchema>;
  previous: SnapshotInput | null;
  targetDate?: string;
  now?: Date;
  fetchOptions?: FetchOptions;
}): Promise<SnapshotInput | null> {
  const now = args.now ?? new Date();
  const registry = new Map(args.registry.map((source) => [source.id, source]));
  if (registry.size !== args.registry.length)
    throw new Error('Duplicate registry entry');
  const used = new Map<string, Source>();
  async function get<T>(id: string, schema: z.ZodType<T>): Promise<T> {
    const source = registry.get(id);
    if (!source) throw new Error(`Source not registered: ${id}`);
    const started = performance.now();
    const result = await fetchApprovedJson(source, schema, args.fetchOptions);
    used.set(id, source);
    console.log(
      JSON.stringify({
        stage: 'fetch',
        source: id,
        rows: Array.isArray(result) ? result.length : null,
        ms: Math.round(performance.now() - started),
      }),
    );
    return result;
  }
  const calendars = normalizeCalendars(
    await get('twse.calendar', exchangeCalendarSchema),
    args.calendar,
  );
  const today = taipeiDate(now);
  if (args.targetDate && !isJointTradingDay(calendars, args.targetDate))
    return null;
  let targetDate = args.targetDate ?? today;
  if (!args.targetDate) {
    for (let i = 0; !isJointTradingDay(calendars, targetDate); i++) {
      if (i > 20) throw new Error('No recent verified trading day');
      const day = new Date(`${targetDate}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() - 1);
      targetDate = day.toISOString().slice(0, 10);
    }
  }
  if (targetDate > today)
    throw new Error('Cannot request a future trading day');
  // Four concurrent requests at most. Quotes are filtered using an independent company master.
  const [twseMaster, tpexMaster, twseRaw, tpexRaw] = await Promise.all([
    get('twse.securities', twseSecuritiesSchema),
    get('tpex.securities', tpexSecuritiesSchema),
    get('twse.daily_price', twseQuotesSchema),
    get('tpex.daily_price', tpexQuotesSchema),
  ]);
  const universe = [
    ...normalizeSecurities('TWSE', twseMaster, targetDate),
    ...normalizeSecurities('TPEX', tpexMaster, targetDate),
  ];
  const ids = new Set(universe.map((item) => item.security.securityId));
  const batches = [
    normalizeQuotes(
      'TWSE',
      twseRaw.filter((row) => ids.has(`TWSE:${row.Code.trim()}`)),
    ),
    normalizeQuotes(
      'TPEX',
      tpexRaw.filter((row) =>
        ids.has(`TPEX:${row.SecuritiesCompanyCode.trim()}`),
      ),
    ),
  ];
  if (assertSameTradingDay(batches) !== targetDate)
    throw new Error(`Official quotes are not ready for ${targetDate}`);
  const exceptions = batches.flatMap((batch) =>
    batch.quotes
      .filter((quote) => quote.daily.close === null)
      .map((quote) => ({
        securityId: `${batch.market}:${quote.symbol}`,
        asOfDate: targetDate,
        reason: 'no_trade' as const,
        source: `${batch.market.toLowerCase()}.quote_exceptions`,
      })),
  );
  for (const item of exceptions) {
    const source = registry.get(item.source);
    if (!source) throw new Error('Missing quote exception provenance');
    used.set(source.id, source);
  }
  let input = assembleQuoteSnapshot({
    snapshotId: now.toISOString(),
    targetDate,
    universe,
    exceptions,
    previous: args.previous,
    batches,
  });
  const stocks = new Map(
    input.stocks.map((stock) => [stock.security.securityId, stock]),
  );
  const freshDatasets: string[] = [];
  const optional: Array<() => Promise<void>> = [];
  for (const market of ['TWSE', 'TPEX'] as const) {
    const prefix = market.toLowerCase();
    optional.push(async () => {
      const id = `${prefix}.valuation`;
      const raw =
        market === 'TWSE'
          ? await get(id, twseValuationSchema)
          : await get(id, tpexValuationSchema);
      const rows = normalizeValuations(market, raw, targetDate);
      for (const row of rows) {
        const stock = stocks.get(`${market}:${row.symbol}`);
        if (!stock) continue;
        for (const key of ['per', 'pbr', 'dividendYieldPct'] as const) {
          stock.latest[key] = row[key];
          if (row[key] !== null)
            stock.latestProvenance[key] = {
              source: id,
              asOfDate: row.asOfDate,
              availableAt: null,
              sourceUnit: key === 'dividendYieldPct' ? 'percent' : 'multiple',
            };
        }
      }
      freshDatasets.push(id);
    });
    optional.push(async () => {
      const id = `${prefix}.revenue`;
      const rows = normalizeRevenue(
        await get(id, revenueRowsSchema),
        id,
        'thousand_TWD',
      );
      for (const { symbol, revenue } of rows) {
        const stock = stocks.get(`${market}:${symbol}`);
        if (!stock || !revenue.asOfDate || revenue.asOfDate > targetDate)
          continue;
        stock.revenues = [
          ...stock.revenues.filter((row) => row.period !== revenue.period),
          revenue,
        ];
        if (revenue.yoyPct !== null && revenue.yoyPct !== undefined) {
          stock.latest.revenueYoyPct = revenue.yoyPct;
          stock.latestProvenance.revenueYoyPct = {
            source: id,
            asOfDate: revenue.asOfDate,
            availableAt: null,
            sourceUnit: 'percent',
          };
        }
      }
      freshDatasets.push(id);
    });
    optional.push(async () => {
      const id = `${prefix}.financial`;
      const previous = new Map(
        input.stocks
          .filter((stock) => stock.security.market === market)
          .map((stock) => [stock.security.symbol, stock.financials]),
      );
      const rows = normalizeFinancials(
        await get(id, financialRowsSchema),
        id,
        previous,
      );
      for (const { symbol, financial } of rows) {
        const stock = stocks.get(`${market}:${symbol}`);
        if (!stock || !financial.asOfDate || financial.asOfDate > targetDate)
          continue;
        stock.financials = [
          ...stock.financials.filter((row) => row.period !== financial.period),
          financial,
        ];
        if (financial.fiscalQuarter === 4 && financial.cumulative) {
          const source = registry.get(`${prefix}.annual`);
          if (!source) throw new Error('Missing annual source');
          used.set(source.id, source);
          const annual = annualSchema.parse({
            ...financial,
            ...financial.cumulative,
            period: String(financial.fiscalYear),
            periodType: 'annual',
            source: source.id,
          });
          stock.annualFinancials = [
            ...stock.annualFinancials.filter(
              (row) => row.period !== annual.period,
            ),
            annual,
          ];
        }
      }
      freshDatasets.push(id);
    });
  }
  optional.push(async () => {
    const id = 'twse.dividends';
    const rows = normalizeDividends(
      await get(id, dividendRowsSchema),
      id,
      targetDate,
    );
    for (const { symbol, dividend } of rows) {
      const stock = stocks.get(`TWSE:${symbol}`);
      if (stock)
        stock.dividends = [
          ...stock.dividends.filter((row) => row.period !== dividend.period),
          dividend,
        ];
    }
    freshDatasets.push(id);
  });
  optional.push(async () => {
    const id = 'tpex.institutional';
    for (const row of normalizeInstitutional(
      await get(id, institutionalRowsSchema),
      targetDate,
    )) {
      const day = stocks
        .get(`TPEX:${row.symbol}`)
        ?.daily.find((day) => day.date === targetDate);
      if (day) day.institutionalNetShares = row.institutionalNetShares;
    }
    freshDatasets.push(id);
  });
  optional.push(async () => {
    const id = 'tpex.margin';
    for (const row of normalizeMargin(
      await get(id, marginRowsSchema),
      targetDate,
    )) {
      const day = stocks
        .get(`TPEX:${row.symbol}`)
        ?.daily.find((day) => day.date === targetDate);
      if (day) day.margin = row.margin;
    }
    freshDatasets.push(id);
  });
  optional.push(async () => {
    const id = 'tdcc.distribution';
    const rows = normalizeOwnership(await get(id, objectRows), id);
    for (const { symbol, ownership } of rows) {
      if (ownership.asOfDate > targetDate) continue;
      for (const market of ['TWSE', 'TPEX']) {
        const stock = stocks.get(`${market}:${symbol}`);
        if (stock)
          stock.ownership = [
            ...stock.ownership.filter(
              (row) => row.asOfDate !== ownership.asOfDate,
            ),
            ownership,
          ];
      }
    }
    freshDatasets.push(id);
  });
  // Optional feeds preserve previous values when their date/schema cannot be validated.
  const queue = optional.slice();
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        try {
          await next();
        } catch (error) {
          console.warn(
            JSON.stringify({
              stage: 'optional-source',
              status: 'stale',
              reason:
                error instanceof Error ? error.message : 'Source unavailable',
            }),
          );
        }
      }
    }),
  );
  const sources = [
    ...(args.previous?.sources ?? []),
    ...[...used.values()].map(sourceMetadata),
  ];
  for (const stock of stocks.values()) {
    const previous = args.previous?.stocks.find(
      (item) => item.security.securityId === stock.security.securityId,
    );
    if (!previous) continue;
    for (const key of [
      'per',
      'pbr',
      'dividendYieldPct',
      'revenueYoyPct',
      'epsTtm',
      'roePct',
    ] as const) {
      if (
        stock.latest[key] === null &&
        previous.latest[key] !== null &&
        previous.latestProvenance[key]
      ) {
        stock.latest[key] = previous.latest[key];
        stock.latestProvenance[key] = previous.latestProvenance[key];
      }
    }
  }
  input = inputSchema.parse({
    ...input,
    stocks: [...stocks.values()],
    sources: [
      ...new Map(sources.map((source) => [source.id, source])).values(),
    ],
    freshDatasets: freshDatasets.sort(),
  });
  return mergeSnapshots(args.previous, input);
}
