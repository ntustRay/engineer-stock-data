import { z } from 'zod/v4';
import {
  dateSchema,
  inputSchema,
  securitySchema,
  type SnapshotInput,
} from './contracts.js';
import { mergeSnapshots } from './merge.js';
import {
  assertSameTradingDay,
  type Quote,
  type QuoteBatch,
} from './providers/quotes.js';

const universeSchema = z
  .array(
    z.object({
      security: securitySchema,
      securityType: z.literal('common_stock'),
      source: z.string().min(1),
    }),
  )
  .min(1);
const exceptionSchema = z.array(
  z.object({
    securityId: z.string(),
    asOfDate: dateSchema,
    reason: z.enum(['suspended', 'no_trade']),
    source: z.string().min(1),
  }),
);

/**
 * Assemble a market snapshot only from an independently verified common-stock
 * universe, dated quote batches and dated exchange exception evidence. This
 * function does not fetch sources or decide whether they are licensed.
 */
export function assembleQuoteSnapshot(args: {
  snapshotId: string;
  targetDate: string;
  universe: z.input<typeof universeSchema>;
  batches: QuoteBatch[];
  exceptions: z.input<typeof exceptionSchema>;
  previous: SnapshotInput | null;
}): SnapshotInput {
  const targetDate = dateSchema.parse(args.targetDate);
  const universe = universeSchema.parse(args.universe);
  const exceptions = exceptionSchema.parse(args.exceptions);
  if (assertSameTradingDay(args.batches) !== targetDate)
    throw new Error(
      'Official quote date does not match the expected trading date',
    );
  const securities = new Set<string>();
  for (const item of universe) {
    if (securities.has(item.security.securityId))
      throw new Error('Duplicate universe security');
    securities.add(item.security.securityId);
  }
  const exceptionIds = new Set<string>();
  for (const item of exceptions) {
    if (item.asOfDate !== targetDate || !securities.has(item.securityId))
      throw new Error('Unmatched or stale market exception');
    if (exceptionIds.has(item.securityId))
      throw new Error('Duplicate market exception');
    exceptionIds.add(item.securityId);
  }
  for (const { security } of universe) {
    if (
      security.status === 'suspended' &&
      !exceptions.some(
        (item) =>
          item.securityId === security.securityId &&
          item.reason === 'suspended',
      )
    )
      throw new Error(`Missing suspension evidence: ${security.securityId}`);
  }
  const quotes = new Map<string, Quote>(
    args.batches.flatMap((batch) =>
      batch.quotes.map(
        (quote) => [`${batch.market}:${quote.symbol}`, quote] as const,
      ),
    ),
  );
  const former = new Map(
    (args.previous?.stocks ?? []).map((s) => [s.security.securityId, s]),
  );
  for (const market of ['TWSE', 'TPEX'] as const) {
    const active = universe.filter(
      ({ security }) =>
        security.market === market && security.status === 'active',
    );
    if (!active.length) throw new Error(`Missing ${market} security universe`);
    const incomplete = active.filter(({ security }) => {
      const daily = quotes.get(security.securityId)?.daily;
      return (
        !exceptionIds.has(security.securityId) &&
        (!daily || daily.close === null || daily.volumeShares === null)
      );
    });
    if (incomplete.length / active.length > 0.01)
      throw new Error(
        `Insufficient ${market} daily coverage: ${incomplete.length}/${active.length}`,
      );
  }
  const stocks = universe.map(({ security }) => {
    const quote = quotes.get(security.securityId);
    const previous = former.get(security.securityId);
    return {
      security,
      daily: quote ? [quote.daily] : [],
      // Valuation provenance must be established by its own provider; never
      // carry an unlabelled prior value forward as though it were current.
      latest: {
        per: null,
        pbr: null,
        dividendYieldPct: null,
        epsTtm: null,
        revenueYoyPct: null,
        roePct: null,
      },
      latestProvenance: {},
      financials: previous?.financials ?? [],
      annualFinancials: previous?.annualFinancials ?? [],
      revenues: previous?.revenues ?? [],
      ownership: previous?.ownership ?? [],
      dividends: previous?.dividends ?? [],
    };
  });
  return mergeSnapshots(
    args.previous,
    inputSchema.parse({
      snapshotId: args.snapshotId,
      asOfDate: targetDate,
      stocks,
      marketExceptions: exceptions,
    }),
  );
}
