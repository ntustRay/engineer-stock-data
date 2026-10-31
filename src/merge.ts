import {
  inputSchema,
  type SnapshotInput,
  type StockInput,
} from './contracts.js';
import {
  retainCompleteMonths,
  retainDaily,
  retainLatest,
} from './retention.js';

/** Merge by natural key; the incoming source replaces a correction at that key. */
function upsert<T>(oldRows: T[], newRows: T[], key: (row: T) => string): T[] {
  const result = new Map<string, T>();
  for (const rows of [oldRows, newRows]) {
    const keys = new Set<string>();
    for (const row of rows) {
      const id = key(row);
      if (keys.has(id)) throw new Error(`Duplicate natural key ${id}`);
      keys.add(id);
      result.set(id, row);
    }
  }
  return [...result.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

/**
 * The incoming list must be the authoritative security universe. Disappearance
 * from a response is not evidence of delisting, so omitted active securities
 * fail the build rather than silently being removed from public data.
 */
export function mergeSnapshots(
  previous: SnapshotInput | null,
  next: SnapshotInput,
): SnapshotInput {
  const incoming = inputSchema.parse(next);
  const old = previous ? inputSchema.parse(previous) : null;
  if (old && old.asOfDate > incoming.asOfDate)
    throw new Error('Snapshot date would move backwards');
  const prior = new Map<string, StockInput>();
  for (const stock of old?.stocks ?? []) {
    if (prior.has(stock.security.securityId))
      throw new Error('Duplicate previous security');
    prior.set(stock.security.securityId, stock);
  }
  const current = new Map<string, StockInput>();
  for (const stock of incoming.stocks) {
    const id = stock.security.securityId;
    if (current.has(id))
      throw new Error('Duplicate security in incoming snapshot');
    current.set(id, stock);
  }
  for (const stock of prior.values()) {
    if (
      stock.security.status !== 'delisted' &&
      !current.has(stock.security.securityId)
    )
      throw new Error(
        `Security disappeared without a delisting record: ${stock.security.securityId}`,
      );
    if (
      stock.security.status === 'delisted' &&
      !current.has(stock.security.securityId)
    )
      current.set(stock.security.securityId, stock);
  }
  const stocks = [...current.values()]
    .map((stock): StockInput => {
      const prev = prior.get(stock.security.securityId);
      const daily = upsert(prev?.daily ?? [], stock.daily, (x) => x.date);
      if (daily.some((x) => x.date > incoming.asOfDate))
        throw new Error('Future daily record');
      return {
        ...stock,
        daily: retainDaily(daily, incoming.asOfDate),
        financials: retainLatest(
          upsert(prev?.financials ?? [], stock.financials, (x) => x.period),
          (x) => x.period,
          12,
        ),
        annualFinancials: retainLatest(
          upsert(
            prev?.annualFinancials ?? [],
            stock.annualFinancials,
            (x) => x.period,
          ),
          (x) => x.period,
          5,
        ),
        revenues: retainCompleteMonths(
          upsert(prev?.revenues ?? [], stock.revenues, (x) => x.period),
          incoming.asOfDate,
        ),
        ownership: retainLatest(
          upsert(prev?.ownership ?? [], stock.ownership, (x) => x.asOfDate),
          (x) => x.asOfDate,
          52,
        ),
        dividends: retainLatest(
          upsert(prev?.dividends ?? [], stock.dividends, (x) => x.period),
          (x) => x.period,
          5,
        ),
      };
    })
    .sort((a, b) => a.security.securityId.localeCompare(b.security.securityId));
  const sources = upsert(
    old?.sources ?? [],
    incoming.sources,
    (source) => source.id,
  );
  return inputSchema.parse({
    ...incoming,
    stocks,
    sources,
    marketExceptions: [...incoming.marketExceptions].sort((a, b) =>
      a.securityId.localeCompare(b.securityId),
    ),
  });
}
