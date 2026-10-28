import { inputSchema, type SnapshotInput } from './contracts.js';
import { manifestPublishedSchema, publishedSchemas } from './published.js';
import { verifySnapshot } from './verify.js';

/** Reconstruct the input model only after validating the entire published snapshot. */
export function loadSnapshot(files: Map<string, string>): SnapshotInput {
  verifySnapshot(files);
  const read = (path: string): unknown => {
    const value = files.get(path);
    if (!value) throw new Error(`Missing snapshot file: ${path}`);
    return JSON.parse(value) as unknown;
  };
  const manifest = manifestPublishedSchema.parse(read('manifest.json'));
  if (!manifest.latestTradingDate)
    throw new Error('Snapshot has no trading date');
  const securities = publishedSchemas.securities.parse(
    read('meta/securities.json'),
  ).data;
  const stocks = securities.map((security) => {
    const id = `${security.market}/${security.symbol}.json`;
    const stock = publishedSchemas.stock.parse(read(`stocks/${id}`));
    return {
      security,
      daily: stock.daily,
      latest: stock.latest,
      latestProvenance: stock.latestProvenance,
      financials: publishedSchemas.quarterly.parse(
        read(`fundamentals/quarterly/${id}`),
      ).data,
      annualFinancials: publishedSchemas.annual.parse(
        read(`fundamentals/annual/${id}`),
      ).data,
      revenues: publishedSchemas.revenue.parse(
        read(`fundamentals/revenue/${id}`),
      ).data,
      ownership: publishedSchemas.ownership.parse(read(`ownership/${id}`)).data,
      dividends: publishedSchemas.dividends.parse(read(`dividends/${id}`)).data,
    };
  });
  return inputSchema.parse({
    snapshotId: manifest.snapshotId,
    asOfDate: manifest.latestTradingDate,
    sources: manifest.sources,
    marketExceptions: publishedSchemas.exceptions.parse(
      read('meta/market-exceptions.json'),
    ).data,
    stocks,
  });
}
