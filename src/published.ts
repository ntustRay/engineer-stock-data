import { z } from 'zod/v4';
import {
  annualSchema,
  dailySchema,
  dateSchema,
  dividendSchema,
  inputSchema,
  latestSchema,
  marketSchema,
  ownershipSchema,
  provenanceSchema,
  quarterlySchema,
  revenueSchema,
  securitySchema,
} from './contracts.js';

const base = {
  schemaVersion: z.string().regex(/^1\.\d+\.\d+$/),
  snapshotId: z.string().datetime(),
};
const datasetStatus = z.enum(['current', 'stale', 'unavailable']);
const institution = dailySchema.shape.institutionalNetShares;
export const stockPublishedSchema = z.object({
  ...base,
  security: securitySchema,
  daily: z.array(dailySchema),
  latest: latestSchema,
  latestProvenance: z.record(z.string(), provenanceSchema),
  datasetStatus: z.record(z.string(), datasetStatus),
});
export const securitiesPublishedSchema = z.object({
  ...base,
  data: z.array(securitySchema),
});
export const screenerPublishedSchema = z.object({
  ...base,
  data: z.array(
    z.object({
      ...securitySchema.shape,
      ...latestSchema.shape,
      asOfDate: dateSchema.nullable(),
      close: z.number().finite().nullable(),
      change: z.number().finite().nullable(),
      changePct: z.number().finite().nullable(),
      volumeShares: z.number().finite().nullable(),
      institutionalNetShares: institution,
      latestProvenance: z.record(z.string(), provenanceSchema),
    }),
  ),
});
export const dailyPublishedSchema = z.object({
  ...base,
  date: dateSchema,
  data: z.array(
    z
      .object({ ...dailySchema.shape, securityId: z.string() })
      .superRefine((value, ctx) => {
        const result = dailySchema.safeParse(value);
        if (!result.success)
          for (const issue of result.error.issues) ctx.addIssue(issue);
      }),
  ),
});
export const manifestPublishedSchema = z.object({
  ...base,
  generatedAt: z.string().datetime(),
  timezone: z.literal('Asia/Taipei'),
  latestTradingDate: dateSchema.nullable(),
  calendarRetentionDays: z.number().int().positive(),
  markets: z.array(marketSchema),
  counts: z.object({
    securities: z.number().int().nonnegative(),
    tradingDates: z.number().int().nonnegative(),
  }),
  sources: inputSchema.shape.sources,
  freshDatasets: z.array(z.string()).default([]),
  datasets: z.record(
    z.string(),
    z.object({ asOfDate: dateSchema.nullable(), status: datasetStatus }),
  ),
  files: z.record(
    z.string(),
    z.object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().nonnegative(),
    }),
  ),
  fixture: z.literal(true).optional(),
});
export const publishedSchemas = {
  manifest: manifestPublishedSchema,
  stock: stockPublishedSchema,
  securities: securitiesPublishedSchema,
  screener: screenerPublishedSchema,
  daily: dailyPublishedSchema,
  quarterly: z.object({ ...base, data: z.array(quarterlySchema) }),
  annual: z.object({ ...base, data: z.array(annualSchema) }),
  revenue: z.object({ ...base, data: z.array(revenueSchema) }),
  ownership: z.object({ ...base, data: z.array(ownershipSchema) }),
  dividends: z.object({ ...base, data: z.array(dividendSchema) }),
  exceptions: z.object({ ...base, data: inputSchema.shape.marketExceptions }),
};
