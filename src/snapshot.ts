import { createHash } from 'node:crypto';
import { inputSchema, type SnapshotInput, type Source } from './contracts.js';

const bytes = (value: unknown): string => JSON.stringify(value);
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
  const input = inputSchema.parse(raw);
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
  for (const market of ['TWSE', 'TPEX'] as const) {
    const active = stocks.filter(
      (s) => s.security.market === market && s.security.status === 'active',
    );
    const complete = active.filter((s) =>
      s.daily.some(
        (d) =>
          d.date === latestDate && d.close !== null && d.volumeShares !== null,
      ),
    );
    if (!active.length || complete.length / active.length < 0.99)
      throw new Error(`Insufficient ${market} daily coverage`);
  }
  const result = new Map<string, string>();
  const add = (path: string, value: unknown) => result.set(path, bytes(value));
  const base = { schemaVersion: '1.0.0', snapshotId: input.snapshotId };
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
    };
  });
  add('meta/securities.json', { ...base, data: stocks.map((s) => s.security) });
  add('index/search.json', { ...base, data: stocks.map((s) => s.security) });
  add('index/screener.json', { ...base, data: screener });
  for (const s of stocks) {
    const { market, symbol } = s.security;
    add(`stocks/${market}/${symbol}.json`, {
      ...base,
      security: s.security,
      daily: s.daily,
      latest: s.latest,
      datasetStatus: {
        daily: 'current',
        financials: s.financials.length ? 'current' : 'unavailable',
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
    add(`ownership/${market}/${symbol}.json`, {
      ...base,
      data: s.ownership.slice(-52),
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
    datasets: {
      daily_prices: { asOfDate: latestDate, status: 'current' },
      quarterly_financials: { asOfDate: null, status: 'unavailable' },
    },
    files,
    ...(options.fixture ? { fixture: true } : {}),
  });
  return result;
}
