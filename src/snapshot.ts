import { createHash } from 'node:crypto';
import { inputSchema, type SnapshotInput, type Source } from './contracts.js';
import { mergeSnapshots } from './merge.js';
import { verifySnapshot } from './verify.js';

// Sort object keys as well as records so source object property order cannot
// change the bytes and hashes of an otherwise identical snapshot.
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    return Object.fromEntries(
      Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
export function assertPublishableSources(sources: Source[]): void {
  for (const market of ['TWSE', 'TPEX'] as const) {
    const source = sources.find(
      (s) => s.market === market && s.category === 'daily_price',
    );
    if (
      !source ||
      !source.redistribution_approved ||
      !source.license_name ||
      !source.license_url ||
      !source.attribution ||
      !source.last_verified_at ||
      !source.schema_fixture
    )
      throw new Error(
        `Missing approved, verified daily-price source for ${market}`,
      );
  }
}
export function createSnapshot(
  raw: SnapshotInput,
  options: { fixture?: boolean } = {},
): Map<string, string> {
  const input = mergeSnapshots(null, inputSchema.parse(raw));
  const ids = new Set<string>();
  const latestDate = input.asOfDate;
  const cutoff = new Date(`${latestDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 29);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const stocks = input.stocks
    .map((s) => {
      const id = s.security.securityId;
      if (ids.has(id)) throw new Error(`Duplicate security ${id}`);
      ids.add(id);
      const dates = new Set<string>();
      for (const day of s.daily) {
        if (dates.has(day.date))
          throw new Error(`Duplicate date ${id} ${day.date}`);
        dates.add(day.date);
        if (day.date > latestDate) throw new Error(`Future date ${id}`);
      }
      return {
        ...s,
        daily: s.daily
          .filter((d) => d.date >= cutoffDate && d.date <= latestDate)
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    })
    .sort((a, b) => a.security.securityId.localeCompare(b.security.securityId));
  const exceptionIds = new Set<string>();
  for (const exception of input.marketExceptions) {
    if (
      exception.asOfDate !== latestDate ||
      !ids.has(exception.securityId) ||
      exceptionIds.has(exception.securityId)
    )
      throw new Error('Invalid or duplicate market exception');
    exceptionIds.add(exception.securityId);
  }
  for (const market of ['TWSE', 'TPEX'] as const) {
    const active = stocks.filter(
      (s) => s.security.market === market && s.security.status === 'active',
    );
    const complete = active.filter(
      (s) =>
        exceptionIds.has(s.security.securityId) ||
        s.daily.some(
          (d) =>
            d.date === latestDate &&
            d.close !== null &&
            d.volumeShares !== null,
        ),
    );
    if (!active.length || complete.length / active.length < 0.99)
      throw new Error(`Insufficient ${market} daily coverage`);
  }
  const result = new Map<string, string>();
  const add = (path: string, value: unknown) =>
    result.set(path, canonicalJson(value));
  const base = { schemaVersion: '1.1.0', snapshotId: input.snapshotId };
  const screener = stocks.map((s) => {
    const d = s.daily.at(-1);
    return {
      ...s.security,
      asOfDate: d?.date ?? null,
      close: d?.close ?? null,
      change: d?.change ?? null,
      changePct: d?.changePct ?? null,
      volumeShares: d?.volumeShares ?? null,
      institutionalNetShares: d?.institutionalNetShares ?? {
        foreign: null,
        investmentTrust: null,
        dealer: null,
      },
      ...s.latest,
      latestProvenance: s.latestProvenance,
    };
  });
  add('meta/securities.json', { ...base, data: stocks.map((s) => s.security) });
  add('meta/market-exceptions.json', {
    ...base,
    data: [...input.marketExceptions].sort((a, b) =>
      a.securityId.localeCompare(b.securityId),
    ),
  });
  add('index/search.json', { ...base, data: stocks.map((s) => s.security) });
  add('index/screener.json', { ...base, data: screener });
  for (const s of stocks) {
    const { market, symbol } = s.security;
    add(`stocks/${market}/${symbol}.json`, {
      ...base,
      security: s.security,
      daily: s.daily,
      latest: s.latest,
      latestProvenance: s.latestProvenance,
      datasetStatus: {
        daily: s.daily.some(
          (day) => day.date === latestDate && day.close !== null,
        )
          ? 'current'
          : s.daily.length
            ? 'stale'
            : 'unavailable',
        financials: s.financials.length
          ? input.freshDatasets.includes(`${market.toLowerCase()}.financial`)
            ? 'current'
            : 'stale'
          : 'unavailable',
        annual: s.annualFinancials.length ? 'stale' : 'unavailable',
        revenue: s.revenues.length
          ? input.freshDatasets.includes(`${market.toLowerCase()}.revenue`)
            ? 'current'
            : 'stale'
          : 'unavailable',
        ownership: s.ownership.length
          ? input.freshDatasets.includes('tdcc.distribution')
            ? 'current'
            : 'stale'
          : 'unavailable',
        dividends: s.dividends.length
          ? input.freshDatasets.includes(`${market.toLowerCase()}.dividends`)
            ? 'current'
            : 'stale'
          : 'unavailable',
      },
    });
    add(`fundamentals/quarterly/${market}/${symbol}.json`, {
      ...base,
      data: s.financials.slice(-12),
    });
    add(`fundamentals/revenue/${market}/${symbol}.json`, {
      ...base,
      data: s.revenues.slice(-36),
    });
    add(`fundamentals/annual/${market}/${symbol}.json`, {
      ...base,
      data: s.annualFinancials.slice(-5),
    });
    add(`ownership/${market}/${symbol}.json`, {
      ...base,
      data: s.ownership.slice(-52),
    });
    add(`dividends/${market}/${symbol}.json`, {
      ...base,
      data: s.dividends.slice(-5),
    });
  }
  const dates = [
    ...new Set(stocks.flatMap((s) => s.daily.map((d) => d.date))),
  ].sort();
  for (const date of dates) {
    const [year, month] = date.split('-');
    add(`daily/${year}/${month}/${date}.json`, {
      ...base,
      date,
      data: stocks.flatMap((s) =>
        s.daily
          .filter((d) => d.date === date)
          .map((d) => ({ securityId: s.security.securityId, ...d })),
      ),
    });
  }
  const files = Object.fromEntries(
    [...result.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => [
        path,
        {
          sha256: createHash('sha256').update(content).digest('hex'),
          bytes: Buffer.byteLength(content),
        },
      ]),
  );
  for (const [path, meta] of Object.entries(files))
    if (meta.bytes > 20 * 1024 * 1024)
      console.warn(`Warning: ${path} exceeds 20 MiB`);
  add('manifest.json', {
    ...base,
    generatedAt: input.snapshotId,
    timezone: 'Asia/Taipei',
    latestTradingDate: latestDate,
    calendarRetentionDays: 30,
    markets: ['TWSE', 'TPEX'],
    counts: { securities: stocks.length, tradingDates: dates.length },
    sources: [...input.sources].sort((a, b) => a.id.localeCompare(b.id)),
    freshDatasets: [...input.freshDatasets].sort(),
    datasets: {
      daily_prices: { asOfDate: latestDate, status: 'current' },
      daily_valuation: {
        asOfDate: latestDate,
        status: input.freshDatasets.some((id) => id.endsWith('.valuation'))
          ? 'current'
          : 'unavailable',
      },
      daily_institutional: {
        asOfDate: input.freshDatasets.includes('tpex.institutional')
          ? latestDate
          : null,
        status: input.freshDatasets.includes('tpex.institutional')
          ? 'current'
          : 'unavailable',
      },
      daily_margin: {
        asOfDate: input.freshDatasets.includes('tpex.margin')
          ? latestDate
          : null,
        status: input.freshDatasets.includes('tpex.margin')
          ? 'current'
          : 'unavailable',
      },
      quarterly_financials: {
        asOfDate:
          stocks
            .flatMap((s) =>
              s.financials
                .map((f) => f.asOfDate)
                .filter((x): x is string => !!x),
            )
            .sort()
            .at(-1) ?? null,
        status: stocks.some((s) => s.financials.length)
          ? input.freshDatasets.some((id) => id.endsWith('.financial'))
            ? 'current'
            : 'stale'
          : 'unavailable',
      },
      annual_financials: {
        asOfDate:
          stocks
            .flatMap((s) =>
              s.annualFinancials
                .map((f) => f.asOfDate)
                .filter((x): x is string => !!x),
            )
            .sort()
            .at(-1) ?? null,
        status: stocks.some((s) => s.annualFinancials.length)
          ? 'stale'
          : 'unavailable',
      },
      monthly_revenues: {
        asOfDate:
          stocks
            .flatMap((s) =>
              s.revenues.map((f) => f.asOfDate).filter((x): x is string => !!x),
            )
            .sort()
            .at(-1) ?? null,
        status: stocks.some((s) => s.revenues.length)
          ? input.freshDatasets.some((id) => id.endsWith('.revenue'))
            ? 'current'
            : 'stale'
          : 'unavailable',
      },
      tdcc_distribution: {
        asOfDate:
          stocks
            .flatMap((s) => s.ownership.map((f) => f.asOfDate))
            .sort()
            .at(-1) ?? null,
        status: stocks.some((s) => s.ownership.length)
          ? input.freshDatasets.includes('tdcc.distribution')
            ? 'current'
            : 'stale'
          : 'unavailable',
      },
      dividends: {
        asOfDate:
          stocks
            .flatMap((s) =>
              s.dividends
                .map((f) => f.asOfDate)
                .filter((x): x is string => !!x),
            )
            .sort()
            .at(-1) ?? null,
        status: stocks.some((s) => s.dividends.length)
          ? input.freshDatasets.some((id) => id.endsWith('.dividends'))
            ? 'current'
            : 'stale'
          : 'unavailable',
      },
    },
    files,
    ...(options.fixture ? { fixture: true } : {}),
  });
  verifySnapshot(result);
  return result;
}
