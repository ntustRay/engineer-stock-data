import { describe, expect, it } from 'bun:test';
import {
  normalizeAnnualFinancial,
  normalizeQuarterlyFinancial,
  type FinancialInput,
} from '../src/financial.js';
import { annualSchema, quarterlySchema } from '../src/contracts.js';

const q1: FinancialInput = {
  fiscalYear: 2026,
  fiscalQuarter: 1,
  flowBasis: 'cumulative',
  accountingBasis: 'consolidated',
  accountingStandard: 'IFRS',
  currency: 'TWD',
  source: 'synthetic-financial',
  sourceUnit: 'thousand_TWD',
  asOfDate: '2026-03-31',
  availableAt: '2026-05-10T00:00:00.000Z',
  revenue: 40,
  grossProfit: 20,
  operatingIncome: 10,
  netIncome: 8,
  cashFlow: 5,
  eps: 1,
  roePct: null,
};
const q2: FinancialInput = {
  ...q1,
  fiscalQuarter: 2,
  asOfDate: '2026-06-30',
  availableAt: '2026-08-10T00:00:00.000Z',
  revenue: 120,
  grossProfit: 60,
  operatingIncome: 30,
  netIncome: 24,
  cashFlow: 17,
  eps: 3,
};

describe('financial normalization', () => {
  it('derives single-quarter monetary amounts from matching cumulative reports', () => {
    const result = normalizeQuarterlyFinancial(q2, q1);
    expect(result.period).toBe('2026-Q2');
    expect(result.revenue).toBe(80000);
    expect(result.grossMarginPct).toBe(50);
    expect(result.cashFlow).toBe(12000);
    expect(result.eps).toBeNull();
    expect(result.availableAt).toBe('2026-08-10T00:00:00.000Z');
  });
  it('never fabricates a quarter or announcement time when its predecessor is unavailable', () => {
    const missing = normalizeQuarterlyFinancial(q2);
    expect(missing.revenue).toBeNull();
    expect(missing.eps).toBeNull();
    const unavailable = normalizeQuarterlyFinancial(q2, {
      ...q1,
      availableAt: null,
    });
    expect(unavailable.availableAt).toBeNull();
    expect(() =>
      normalizeQuarterlyFinancial(q2, { ...q1, accountingBasis: 'individual' }),
    ).toThrow(/incompatible/);
  });
  it('keeps balance-sheet values as of the reporting date and requires cumulative Q4 for annual reports', () => {
    const q4: FinancialInput = {
      ...q2,
      fiscalQuarter: 4,
      asOfDate: '2026-12-31',
      revenue: 500,
      totalAssets: 2000,
      totalLiabilities: 800,
    };
    const annual = normalizeAnnualFinancial(q4);
    expect(annual.revenue).toBe(500000);
    expect(annual.totalAssets).toBe(2000000);
    expect(annual.totalLiabilities).toBe(800000);
    expect(() =>
      normalizeAnnualFinancial({ ...q4, flowBasis: 'single' }),
    ).toThrow(/cumulative Q4/);
    expect(() =>
      quarterlySchema.parse({ period: '2026-Q2', fiscalQuarter: 3 }),
    ).toThrow();
    expect(() =>
      annualSchema.parse({ period: '2026', fiscalYear: 2025 }),
    ).toThrow();
  });
});
