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

function parseQuote(
  row: z.infer<typeof twseQuote> | z.infer<typeof tpexQuote>,
  market: Market,
  symbol: string,
  date: string,
): Quote {
  const isTwse = 'Code' in row;
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
  return { symbol, name, daily };
}

export const quoteRowsSchema = z
  .array(z.record(z.string(), z.unknown()))
  .min(1);

export function normalizeQuotes(
  market: Market,
  input: unknown,
  listingDates?: ReadonlyMap<string, string>,
): QuoteBatch {
  const rows = quoteRowsSchema.parse(input);
  const rowSchema = market === 'TWSE' ? twseQuote : tpexQuote;
  const idField = market === 'TWSE' ? 'Code' : 'SecuritiesCompanyCode';
  const seen = new Set<string>();
  let observedDate: string | undefined;
  const quotes: Quote[] = [];
  for (const raw of rows) {
    const symbol = textField.parse(raw[idField]).trim();
    const listedAt = listingDates?.get(`${market}:${symbol}`);
    if (listingDates && !listedAt) continue;
    symbolSchema.parse(symbol);
    if (seen.has(symbol))
      throw new Error(`Duplicate ${market} quote ${symbol}`);
    seen.add(symbol);
    const date = parseDate(textField.parse(raw.Date));
    if (observedDate && observedDate !== date)
      throw new Error(`Mixed dates in ${market} quotes`);
    observedDate = date;
    try {
      const quote = parseQuote(rowSchema.parse(raw), market, symbol, date);
      if (listedAt === date) {
        const { open, high, low, close, volumeShares } = quote.daily;
        if (
          [open, high, low, close, volumeShares].some(
            (v) => v === null || v <= 0,
          )
        )
          throw new Error('Missing first-day trade');
      }
      quotes.push(quote);
    } catch (error) {
      if (listedAt !== date) throw error;
      console.warn(
        JSON.stringify({
          stage: 'listing-quote',
          status: 'awaiting-valid-quote',
          source: `${market.toLowerCase()}.daily_price`,
          symbol,
          date,
          reason:
            error instanceof z.ZodError
              ? error.issues
                  .map((issue) =>
                    [issue.path.join('.'), issue.message]
                      .filter(Boolean)
                      .join(': '),
                  )
                  .join(', ')
              : String(error),
        }),
      );
    }
  }
  const asOfDate = quotes[0]?.daily.date;
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
