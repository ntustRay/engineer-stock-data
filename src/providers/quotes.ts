import { z } from 'zod/v4';
import { dailySchema, type marketSchema, symbolSchema } from '../contracts.js';
import { parseDate, parseNumber, toShares } from '../normalize.js';

// These source schemas must be verified against live official responses before
// the production publication gate in cli.ts is removed.
const textField = z.string();
const twseQuote = z.object({
  Date: textField,
  Code: textField,
  Name: textField,
  OpeningPrice: textField,
  HighestPrice: textField,
  LowestPrice: textField,
  ClosingPrice: textField,
  TradeVolume: textField,
  TradeValue: textField,
  Change: textField,
  Transaction: textField.optional(),
});
const tpexQuote = z.object({
  Date: textField,
  SecuritiesCompanyCode: textField,
  CompanyName: textField,
  Open: textField,
  High: textField,
  Low: textField,
  Close: textField,
  TradingShares: textField,
  TransactionAmount: textField,
  Change: textField,
  TransactionNumber: textField.optional(),
});

export const twseQuotesSchema = z.array(twseQuote).min(1);
export const tpexQuotesSchema = z.array(tpexQuote).min(1);
export type Market = z.infer<typeof marketSchema>;
export type Quote = {
  symbol: string;
  name: string;
  daily: z.infer<typeof dailySchema>;
};
export type QuoteBatch = { market: Market; asOfDate: string; quotes: Quote[] };

export function normalizeQuotes(market: Market, input: unknown): QuoteBatch {
  const rows =
    market === 'TWSE'
      ? twseQuotesSchema.parse(input)
      : tpexQuotesSchema.parse(input);
  const seen = new Set<string>();
  let asOfDate: string | null = null;
  const quotes: Quote[] = [];
  for (const row of rows) {
    const isTwse = 'Code' in row;
    const symbol = symbolSchema.parse(
      (isTwse ? row.Code : row.SecuritiesCompanyCode).trim(),
    );
    if (seen.has(symbol))
      throw new Error(`Duplicate ${market} quote ${symbol}`);
    seen.add(symbol);
    const date = parseDate(row.Date);
    if (asOfDate !== null && asOfDate !== date)
      throw new Error(`Mixed dates in ${market} quotes`);
    asOfDate = date;
    const close = parseNumber(isTwse ? row.ClosingPrice : row.Close);
    const change = parseNumber(row.Change);
    const previousClose =
      close !== null && change !== null ? close - change : null;
    const changePct =
      previousClose !== null && previousClose > 0 && change !== null
        ? (change / previousClose) * 100
        : null;
    const daily = dailySchema.parse({
      date,
      open: parseNumber(isTwse ? row.OpeningPrice : row.Open),
      high: parseNumber(isTwse ? row.HighestPrice : row.High),
      low: parseNumber(isTwse ? row.LowestPrice : row.Low),
      close,
      volumeShares: toShares(
        parseNumber(isTwse ? row.TradeVolume : row.TradingShares),
        'shares',
      ),
      turnoverTwd: parseNumber(isTwse ? row.TradeValue : row.TransactionAmount),
      trades: parseNumber(isTwse ? row.Transaction : row.TransactionNumber),
      change,
      changePct,
      institutionalNetShares: {
        foreign: null,
        investmentTrust: null,
        dealer: null,
      },
    });
    const name = (isTwse ? row.Name : row.CompanyName).trim();
    if (!name) throw new Error(`Missing ${market} name for ${symbol}`);
    quotes.push({ symbol, name, daily });
  }
  if (!asOfDate) throw new Error(`No ${market} quote date`);
  return { market, asOfDate, quotes };
}

export function assertSameTradingDay(batches: QuoteBatch[]): string {
  if (batches.length !== 2 || new Set(batches.map((b) => b.market)).size !== 2)
    throw new Error('Both market quote batches are required');
  if (batches[0].asOfDate !== batches[1].asOfDate)
    throw new Error('TWSE and TPEx quote dates do not match');
  return batches[0].asOfDate;
}
