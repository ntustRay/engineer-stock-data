import { z } from 'zod';

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
    change: amount.default(null),
    changePct: amount.default(null),
    institutionalNetShares: z.object({
      foreign: amount,
      investmentTrust: amount,
      dealer: amount,
    }),
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
export const stockInputSchema = z.object({
  security: securitySchema,
  daily: z.array(dailySchema),
  latest: latestSchema,
  financials: z.array(z.unknown()).default([]),
  revenues: z.array(z.unknown()).default([]),
  ownership: z.array(z.unknown()).default([]),
});
export const inputSchema = z.object({
  snapshotId: z.string().datetime(),
  asOfDate: dateSchema,
  stocks: z.array(stockInputSchema).min(1),
});
export type SnapshotInput = z.infer<typeof inputSchema>;
export type StockInput = z.infer<typeof stockInputSchema>;
export const sourceSchema = z.object({
  id: z.string(),
  provider: z.string(),
  url: z.string().url(),
  category: z.string(),
  market: z.enum(['TWSE', 'TPEX', 'BOTH']),
  frequency: z.string(),
  license_name: z.string().nullable(),
  license_url: z.string().url().nullable(),
  redistribution_approved: z.boolean(),
  attribution: z.string().nullable(),
  schema_fixture: z.string().nullable(),
  last_verified_at: z.string().nullable(),
});
export type Source = z.infer<typeof sourceSchema>;
