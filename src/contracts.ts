import { z } from 'zod/v4';

export const marketSchema = z.enum(['TWSE', 'TPEX']);
export const symbolSchema = z.string().regex(/^[A-Za-z0-9]{2,12}$/);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
      new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v,
  );
const amount = z.number().finite().nullable();
export const securitySchema = z
  .object({
    securityId: z.string(),
    symbol: symbolSchema,
    market: marketSchema,
    name: z.string().min(1),
    industry: z.string().nullable(),
    status: z.enum(['active', 'suspended', 'delisted']),
  })
  .superRefine((s, ctx) => {
    if (s.securityId !== `${s.market}:${s.symbol}`)
      ctx.addIssue({ code: 'custom', message: 'securityId mismatch' });
  });
export const dailySchema = z
  .object({
    date: dateSchema,
    open: amount,
    high: amount,
    low: amount,
    close: amount,
    volumeShares: amount,
    turnoverTwd: amount,
    trades: z.number().int().nonnegative().nullable().optional(),
    change: amount.default(null),
    changePct: amount.default(null),
    institutionalNetShares: z.object({
      foreign: amount,
      investmentTrust: amount,
      dealer: amount,
    }),
    margin: z
      .object({
        asOfDate: dateSchema,
        marginBalanceShares: amount,
        marginChangeShares: amount,
        shortBalanceShares: amount,
        shortChangeShares: amount,
      })
      .nullable()
      .optional(),
  })
  .superRefine((d, ctx) => {
    if (d.volumeShares !== null && d.volumeShares < 0)
      ctx.addIssue({ code: 'custom', message: 'negative volume' });
    const { open, high, low, close } = d;
    if (
      open !== null &&
      high !== null &&
      low !== null &&
      close !== null &&
      (high < Math.max(open, low, close) || low > Math.min(open, high, close))
    )
      ctx.addIssue({ code: 'custom', message: 'invalid OHLC' });
  });
export const latestSchema = z.object({
  per: amount,
  pbr: amount,
  dividendYieldPct: amount,
  epsTtm: amount,
  revenueYoyPct: amount,
  roePct: amount,
});
export const provenanceSchema = z.object({
  source: z.string().min(1),
  asOfDate: dateSchema,
  availableAt: z.string().datetime().nullable(),
  sourceUnit: z.string().min(1),
});
const datasetMetadata = {
  source: z.string().min(1).optional(),
  asOfDate: dateSchema.optional(),
  availableAt: z.string().datetime().nullable().optional(),
  sourceUnit: z.string().optional(),
};
const financialFields = {
  revenue: amount.optional(),
  grossProfit: amount.optional(),
  operatingIncome: amount.optional(),
  netIncome: amount.optional(),
  totalAssets: amount.optional(),
  totalLiabilities: amount.optional(),
  eps: amount.optional(),
  grossMarginPct: amount.optional(),
  operatingMarginPct: amount.optional(),
  roePct: amount.optional(),
  cashFlow: amount.optional(),
  currency: z.literal('TWD').optional(),
  accountingBasis: z.enum(['consolidated', 'individual']).optional(),
  accountingStandard: z.string().optional(),
  fiscalYear: z.number().int().optional(),
  derivedFields: z.array(z.string()).optional(),
};
export const quarterlySchema = z
  .object({
    period: z.string().regex(/^\d{4}-Q[1-4]$/),
    periodType: z.literal('quarter').optional(),
    fiscalQuarter: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
      .optional(),
    ...datasetMetadata,
    ...financialFields,
    cumulative: z
      .object({
        flowBasis: z.literal('year_to_date'),
        revenue: amount,
        grossProfit: amount,
        operatingIncome: amount,
        netIncome: amount,
        eps: amount,
        grossMarginPct: amount,
        operatingMarginPct: amount,
      })
      .optional(),
  })
  .passthrough()
  .superRefine((record, ctx) => {
    if (
      record.fiscalYear !== undefined &&
      String(record.fiscalYear) !== record.period.slice(0, 4)
    )
      ctx.addIssue({ code: 'custom', message: 'Quarter fiscal year mismatch' });
    if (
      record.fiscalQuarter !== undefined &&
      String(record.fiscalQuarter) !== record.period.slice(-1)
    )
      ctx.addIssue({ code: 'custom', message: 'Fiscal quarter mismatch' });
  });
export const annualSchema = z
  .object({
    period: z.string().regex(/^\d{4}$/),
    periodType: z.literal('annual').optional(),
    ...datasetMetadata,
    ...financialFields,
  })
  .passthrough()
  .superRefine((record, ctx) => {
    if (
      record.fiscalYear !== undefined &&
      String(record.fiscalYear) !== record.period
    )
      ctx.addIssue({ code: 'custom', message: 'Annual fiscal year mismatch' });
  });
export const revenueSchema = z
  .object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    ...datasetMetadata,
    revenue: amount.optional(),
    momPct: amount.optional(),
    yoyPct: amount.optional(),
    cumulativeRevenue: amount.optional(),
    cumulativeYoyPct: amount.optional(),
  })
  .passthrough();
export const ownershipSchema = z
  .object({
    asOfDate: dateSchema,
    levels: z.array(
      z
        .object({
          level: z.string(),
          holders: z.number().int().nonnegative().nullable(),
          shares: z.number().int().nonnegative().nullable(),
          percentage: z.number().min(0).max(100).nullable(),
        })
        .passthrough(),
    ),
    source: z.string().min(1).optional(),
    availableAt: z.string().datetime().nullable().optional(),
  })
  .passthrough();
export const dividendSchema = z
  .object({
    period: z.string().regex(/^\d{4}$/),
    ...datasetMetadata,
    cashDividend: amount.optional(),
    stockDividend: amount.optional(),
    exDividendDate: dateSchema.nullable().optional(),
    exRightsDate: dateSchema.nullable().optional(),
  })
  .passthrough();
export const stockInputSchema = z.object({
  security: securitySchema,
  daily: z.array(dailySchema),
  latest: latestSchema,
  latestProvenance: z.record(z.string(), provenanceSchema).default({}),
  financials: z.array(quarterlySchema).default([]),
  annualFinancials: z.array(annualSchema).default([]),
  revenues: z.array(revenueSchema).default([]),
  ownership: z.array(ownershipSchema).default([]),
  dividends: z.array(dividendSchema).default([]),
});
export const inputSchema = z.object({
  snapshotId: z.string().datetime(),
  asOfDate: dateSchema,
  stocks: z.array(stockInputSchema).min(1),
  marketExceptions: z
    .array(
      z.object({
        securityId: z.string(),
        asOfDate: dateSchema,
        reason: z.enum(['suspended', 'no_trade']),
        source: z.string().min(1),
      }),
    )
    .default([]),
  sources: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        provider: z.string().min(1),
        sourceUrl: z
          .string()
          .url()
          .refine((url) => url.startsWith('https://')),
        licenseUrl: z
          .string()
          .url()
          .refine((url) => url.startsWith('https://')),
        attribution: z.string().min(1),
        lastVerifiedAt: dateSchema,
      }),
    )
    .default([]),
  freshDatasets: z.array(z.string()).default([]),
});
export type SnapshotInput = z.infer<typeof inputSchema>;
export type StockInput = z.infer<typeof stockInputSchema>;
export const sourceSchema = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  provider: z.string(),
  url: z.string().url(),
  category: z.string(),
  market: z.enum(['TWSE', 'TPEX', 'BOTH']),
  frequency: z.string(),
  license_name: z.string().nullable(),
  license_url: z.string().url().nullable(),
  license_dataset_url: z.string().url().optional(),
  license_verified_at: dateSchema.optional(),
  redistribution_approved: z.boolean(),
  attribution: z.string().nullable(),
  schema_fixture: z.string().nullable(),
  last_verified_at: z.string().nullable(),
});
export type Source = z.infer<typeof sourceSchema>;
