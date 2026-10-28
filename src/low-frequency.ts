import { z } from 'zod/v4';
import {
  annualSchema,
  dividendSchema,
  ownershipSchema,
  quarterlySchema,
  revenueSchema,
  type SnapshotInput,
} from './contracts.js';
import { mergeSnapshots } from './merge.js';

const updateSchema = z.array(
  z.object({
    securityId: z.string(),
    financials: z.array(quarterlySchema).optional(),
    annualFinancials: z.array(annualSchema).optional(),
    revenues: z.array(revenueSchema).optional(),
    ownership: z.array(ownershipSchema).optional(),
    dividends: z.array(dividendSchema).optional(),
  }),
);

/** Apply source corrections by period while preserving absent low-frequency data. */
export function applyLowFrequencyUpdates(
  previous: SnapshotInput,
  snapshotId: string,
  input: z.input<typeof updateSchema>,
): SnapshotInput {
  const updates = updateSchema.parse(input);
  const byId = new Map<string, z.infer<typeof updateSchema>[number]>();
  const existingIds = new Set(
    previous.stocks.map((stock) => stock.security.securityId),
  );
  for (const update of updates) {
    if (!existingIds.has(update.securityId))
      throw new Error(`Unknown security: ${update.securityId}`);
    if (byId.has(update.securityId))
      throw new Error(`Duplicate update: ${update.securityId}`);
    byId.set(update.securityId, update);
  }
  const stocks = previous.stocks.map((stock) => {
    const update = byId.get(stock.security.securityId);
    return {
      ...stock,
      daily: [],
      financials: update?.financials ?? [],
      annualFinancials: update?.annualFinancials ?? [],
      revenues: update?.revenues ?? [],
      ownership: update?.ownership ?? [],
      dividends: update?.dividends ?? [],
    };
  });
  return mergeSnapshots(previous, { ...previous, snapshotId, stocks });
}
