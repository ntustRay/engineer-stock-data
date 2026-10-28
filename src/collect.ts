import { inputSchema, type SnapshotInput, type Source } from './contracts.js';
import { assembleQuoteSnapshot } from './assemble.js';
import { fetchApprovedJson, type FetchOptions } from './fetch.js';
import { mergeSnapshots } from './merge.js';
import {
  normalizeQuotes,
  tpexQuotesSchema,
  twseQuotesSchema,
} from './providers/quotes.js';
import { assertPublishableSources } from './snapshot.js';
import { isJointTradingDay, type MarketCalendar } from './calendar.js';

type Assembly = Parameters<typeof assembleQuoteSnapshot>[0];

/**
 * Fetch approved quote datasets and assemble them against an independently
 * validated universe/calendar. This function does not publish a branch.
 */
export async function collectQuoteSnapshot(args: {
  snapshotId: string;
  targetDate: string;
  universe: Assembly['universe'];
  exceptions: Assembly['exceptions'];
  previous: SnapshotInput | null;
  calendars: MarketCalendar[];
  registry: Source[];
  fetchOptions?: FetchOptions;
}): Promise<SnapshotInput | null> {
  const byId = new Map(args.registry.map((source) => [source.id, source]));
  if (byId.size !== args.registry.length)
    throw new Error('Duplicate source registry id');
  const sourceFor = (market: 'TWSE' | 'TPEX') => {
    const matches = args.registry.filter(
      (source) => source.market === market && source.category === 'daily_price',
    );
    if (matches.length !== 1)
      throw new Error(`Expected one ${market} quote source`);
    return matches[0];
  };
  const twse = sourceFor('TWSE');
  const tpex = sourceFor('TPEX');
  assertPublishableSources([twse, tpex]);
  const usedIds = new Set([twse.id, tpex.id]);
  for (const calendar of args.calendars) {
    const source = byId.get(calendar.source);
    if (
      !source ||
      source.category !== 'trading_calendar' ||
      (source.market !== calendar.market && source.market !== 'BOTH')
    )
      throw new Error(`Invalid calendar source: ${calendar.source}`);
    usedIds.add(source.id);
  }
  for (const item of args.universe) {
    const source = byId.get(item.source);
    if (
      !source ||
      source.category !== 'securities' ||
      (source.market !== item.security.market && source.market !== 'BOTH')
    )
      throw new Error(`Invalid securities source: ${item.source}`);
    usedIds.add(source.id);
  }
  for (const item of args.exceptions) {
    const source = byId.get(item.source);
    if (!source || source.category !== 'market_exceptions')
      throw new Error(`Invalid exception source: ${item.source}`);
    usedIds.add(source.id);
  }
  const usedSources = [...usedIds].map((id) => {
    const source = byId.get(id);
    if (
      !source ||
      !source.redistribution_approved ||
      !source.license_name ||
      !source.license_url ||
      !source.attribution ||
      !source.schema_fixture ||
      !source.last_verified_at
    )
      throw new Error(`Unapproved source: ${id}`);
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
  if (!isJointTradingDay(args.calendars, args.targetDate)) return null;
  const [twseRows, tpexRows] = await Promise.all([
    fetchApprovedJson(twse, twseQuotesSchema, args.fetchOptions),
    fetchApprovedJson(tpex, tpexQuotesSchema, args.fetchOptions),
  ]);
  const snapshot = assembleQuoteSnapshot({
    snapshotId: args.snapshotId,
    targetDate: args.targetDate,
    universe: args.universe,
    exceptions: args.exceptions,
    previous: args.previous,
    batches: [
      normalizeQuotes('TWSE', twseRows),
      normalizeQuotes('TPEX', tpexRows),
    ],
  });
  return mergeSnapshots(
    snapshot,
    inputSchema.parse({ ...snapshot, sources: usedSources }),
  );
}
