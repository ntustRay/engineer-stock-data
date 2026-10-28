import { z } from 'zod/v4';
import { annualSchema, dateSchema, quarterlySchema } from './contracts.js';
import { singleQuarter, toTwd } from './normalize.js';

const amount = z.number().finite().nullable();
const inputSchema = z.object({
  fiscalYear: z.number().int().min(1900).max(9999),
  fiscalQuarter: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
  ]),
  flowBasis: z.enum(['single', 'cumulative']),
  accountingBasis: z.enum(['consolidated', 'individual']),
  accountingStandard: z.string().min(1),
  currency: z.literal('TWD'),
  source: z.string().min(1),
  sourceUnit: z.enum(['TWD', 'thousand_TWD', 'million_TWD']),
  asOfDate: dateSchema,
  availableAt: z.string().datetime().nullable(),
  revenue: amount,
  grossProfit: amount,
  operatingIncome: amount,
  netIncome: amount,
  cashFlow: amount,
  totalAssets: amount.optional(),
  totalLiabilities: amount.optional(),
  eps: amount,
  roePct: amount,
});
export type FinancialInput = z.infer<typeof inputSchema>;

/**
 * Normalize quarterly monetary flows. Cumulative Q2–Q4 amounts are reduced by
 * the immediately preceding cumulative report of the same financial year.
 * Cumulative EPS is not subtracted: weighted share counts can differ.
 */
export function normalizeQuarterlyFinancial(
  currentInput: FinancialInput,
  previousInput?: FinancialInput,
) {
  const current = inputSchema.parse(currentInput);
  const previous = previousInput ? inputSchema.parse(previousInput) : undefined;
  if (
    previous &&
    (previous.fiscalYear !== current.fiscalYear ||
      previous.fiscalQuarter !== current.fiscalQuarter - 1 ||
      previous.accountingBasis !== current.accountingBasis ||
      previous.accountingStandard !== current.accountingStandard ||
      previous.currency !== current.currency ||
      previous.source !== current.source ||
      previous.sourceUnit !== current.sourceUnit ||
      previous.flowBasis !== 'cumulative')
  )
    throw new Error('Previous cumulative financial report is incompatible');
  const fields = [
    'revenue',
    'grossProfit',
    'operatingIncome',
    'netIncome',
    'cashFlow',
  ] as const;
  const converted: Record<(typeof fields)[number], number | null> = {
    revenue: null,
    grossProfit: null,
    operatingIncome: null,
    netIncome: null,
    cashFlow: null,
  };
  const derivedFields: string[] = [];
  for (const field of fields) {
    const now = toTwd(current[field], current.sourceUnit);
    if (current.flowBasis === 'single') converted[field] = now;
    else {
      const result = singleQuarter(
        now,
        previous ? toTwd(previous[field], previous.sourceUnit) : null,
        current.fiscalQuarter,
      );
      converted[field] = result.value;
      if (result.derived) derivedFields.push(field);
    }
  }
  const ratio = (numerator: number | null, denominator: number | null) =>
    numerator === null || denominator === null || denominator === 0
      ? null
      : (numerator / denominator) * 100;
  const availableAt =
    derivedFields.length > 0
      ? current.availableAt && previous?.availableAt
        ? new Date(
            Math.max(
              Date.parse(current.availableAt),
              Date.parse(previous.availableAt),
            ),
          ).toISOString()
        : null
      : current.availableAt;
  return quarterlySchema.parse({
    period: `${current.fiscalYear}-Q${current.fiscalQuarter}`,
    periodType: 'quarter',
    fiscalYear: current.fiscalYear,
    fiscalQuarter: current.fiscalQuarter,
    accountingBasis: current.accountingBasis,
    accountingStandard: current.accountingStandard,
    currency: current.currency,
    source: current.source,
    sourceUnit: current.sourceUnit,
    asOfDate: current.asOfDate,
    availableAt,
    ...converted,
    totalAssets: toTwd(current.totalAssets ?? null, current.sourceUnit),
    totalLiabilities: toTwd(
      current.totalLiabilities ?? null,
      current.sourceUnit,
    ),
    grossMarginPct: ratio(converted.grossProfit, converted.revenue),
    operatingMarginPct: ratio(converted.operatingIncome, converted.revenue),
    eps:
      current.flowBasis === 'single' || current.fiscalQuarter === 1
        ? current.eps
        : null,
    roePct:
      current.flowBasis === 'single' || current.fiscalQuarter === 1
        ? current.roePct
        : null,
    derivedFields,
  });
}

/** An annual report must represent cumulative Q4, not an isolated fourth quarter. */
export function normalizeAnnualFinancial(input: FinancialInput) {
  const report = inputSchema.parse(input);
  if (report.fiscalQuarter !== 4 || report.flowBasis !== 'cumulative')
    throw new Error('Annual report requires cumulative Q4 data');
  const revenue = toTwd(report.revenue, report.sourceUnit);
  const grossProfit = toTwd(report.grossProfit, report.sourceUnit);
  const operatingIncome = toTwd(report.operatingIncome, report.sourceUnit);
  const ratio = (value: number | null) =>
    value === null || revenue === null || revenue === 0
      ? null
      : (value / revenue) * 100;
  return annualSchema.parse({
    period: String(report.fiscalYear),
    periodType: 'annual',
    fiscalYear: report.fiscalYear,
    accountingBasis: report.accountingBasis,
    accountingStandard: report.accountingStandard,
    currency: report.currency,
    source: report.source,
    sourceUnit: report.sourceUnit,
    asOfDate: report.asOfDate,
    availableAt: report.availableAt,
    revenue,
    grossProfit,
    operatingIncome,
    netIncome: toTwd(report.netIncome, report.sourceUnit),
    cashFlow: toTwd(report.cashFlow, report.sourceUnit),
    totalAssets: toTwd(report.totalAssets ?? null, report.sourceUnit),
    totalLiabilities: toTwd(report.totalLiabilities ?? null, report.sourceUnit),
    grossMarginPct: ratio(grossProfit),
    operatingMarginPct: ratio(operatingIncome),
    eps: report.eps,
    roePct: report.roePct,
  });
}
