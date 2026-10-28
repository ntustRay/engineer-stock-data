import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { manifestPublishedSchema, publishedSchemas } from './published.js';

function schemaFor(path: string): z.ZodType | null {
  if (path === 'meta/securities.json' || path === 'index/search.json')
    return publishedSchemas.securities;
  if (path === 'meta/market-exceptions.json')
    return publishedSchemas.exceptions;
  if (path === 'index/screener.json') return publishedSchemas.screener;
  if (/^stocks\/(TWSE|TPEX)\/[A-Za-z0-9]{2,12}\.json$/.test(path))
    return publishedSchemas.stock;
  if (/^daily\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}\.json$/.test(path))
    return publishedSchemas.daily;
  const fundamental =
    /^fundamentals\/(quarterly|annual|revenue)\/(TWSE|TPEX)\/[A-Za-z0-9]{2,12}\.json$/.exec(
      path,
    );
  if (fundamental)
    return publishedSchemas[
      fundamental[1] as 'quarterly' | 'annual' | 'revenue'
    ];
  if (/^ownership\/(TWSE|TPEX)\/[A-Za-z0-9]{2,12}\.json$/.test(path))
    return publishedSchemas.ownership;
  if (/^dividends\/(TWSE|TPEX)\/[A-Za-z0-9]{2,12}\.json$/.test(path))
    return publishedSchemas.dividends;
  return null;
}

/** Validate all bytes, contracts and cross-file identifiers before publishing. */
export function verifySnapshot(files: Map<string, string>): void {
  const manifestText = files.get('manifest.json');
  if (!manifestText) throw new Error('Missing manifest');
  const manifest = manifestPublishedSchema.parse(JSON.parse(manifestText));
  const entries = [...files.entries()].filter(
    ([path]) => path !== 'manifest.json',
  );
  if (entries.length !== Object.keys(manifest.files).length)
    throw new Error('Manifest file count mismatch');
  for (const [path, content] of entries) {
    const meta = manifest.files[path];
    if (
      !meta ||
      meta.bytes !== Buffer.byteLength(content) ||
      meta.sha256 !== createHash('sha256').update(content).digest('hex')
    )
      throw new Error(`File integrity mismatch: ${path}`);
    const schema = schemaFor(path);
    if (!schema) throw new Error(`Unexpected snapshot path: ${path}`);
    const parsed = schema.parse(JSON.parse(content));
    const version = zBase.parse(parsed);
    if (
      version.snapshotId !== manifest.snapshotId ||
      version.schemaVersion !== manifest.schemaVersion
    )
      throw new Error(`Snapshot version mismatch: ${path}`);
  }
  const read = (path: string) => {
    const value = files.get(path);
    if (!value) throw new Error(`Missing required snapshot file: ${path}`);
    return JSON.parse(value) as unknown;
  };
  const securities = publishedSchemas.securities.parse(
    read('meta/securities.json'),
  ).data;
  const screener = publishedSchemas.screener.parse(
    read('index/screener.json'),
  ).data;
  const search = publishedSchemas.securities.parse(
    read('index/search.json'),
  ).data;
  const ids = new Set(securities.map((security) => security.securityId));
  if (
    ids.size !== securities.length ||
    ids.size !== manifest.counts.securities ||
    screener.length !== ids.size ||
    search.length !== ids.size
  )
    throw new Error('Security count mismatch');
  const screenerIds = new Set(screener.map((row) => row.securityId));
  const searchIds = new Set(search.map((row) => row.securityId));
  if (
    screenerIds.size !== ids.size ||
    searchIds.size !== ids.size ||
    [...ids].some((id) => !screenerIds.has(id) || !searchIds.has(id))
  )
    throw new Error('Security index mismatch');
  if (screener.some((row) => row.securityId !== `${row.market}:${row.symbol}`))
    throw new Error('Screener identity mismatch');
  const stockFiles = entries.filter(([path]) => path.startsWith('stocks/'));
  if (stockFiles.length !== ids.size)
    throw new Error('Stock read-model count mismatch');
  const dailyBySecurity = new Map<string, Map<string, string>>();
  for (const security of securities) {
    const path = `stocks/${security.market}/${security.symbol}.json`;
    const stock = publishedSchemas.stock.parse(read(path));
    if (JSON.stringify(stock.security) !== JSON.stringify(security))
      throw new Error(`Security identity mismatch: ${path}`);
    if (new Set(stock.daily.map((day) => day.date)).size !== stock.daily.length)
      throw new Error(`Duplicate daily date: ${path}`);
    dailyBySecurity.set(
      security.securityId,
      new Map(stock.daily.map((day) => [day.date, JSON.stringify(day)])),
    );
  }
  const days = entries.filter(([path]) => path.startsWith('daily/'));
  if (days.length !== manifest.counts.tradingDates)
    throw new Error('Trading date count mismatch');
  for (const [path, content] of days) {
    const day = publishedSchemas.daily.parse(JSON.parse(content));
    if (
      !path.endsWith(`/${day.date}.json`) ||
      day.data.some(
        (record) => record.date !== day.date || !ids.has(record.securityId),
      )
    )
      throw new Error(`Daily index mismatch: ${path}`);
    if (
      new Set(day.data.map((record) => record.securityId)).size !==
      day.data.length
    )
      throw new Error(`Duplicate daily security: ${path}`);
    for (const record of day.data) {
      const { securityId, ...value } = record;
      const matching = dailyBySecurity.get(securityId);
      if (!matching || matching.get(day.date) !== JSON.stringify(value))
        throw new Error(`Daily read-model mismatch: ${path}`);
      matching.delete(day.date);
    }
  }
  if ([...dailyBySecurity.values()].some((daysByDate) => daysByDate.size !== 0))
    throw new Error('Daily read model is missing from the daily index');
}

// Every published file includes this common version header.
const zBase = z.object({ snapshotId: z.string(), schemaVersion: z.string() });
