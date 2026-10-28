import type { Source } from './contracts.js';
import { manifestPublishedSchema, publishedSchemas } from './published.js';
import { assertPublishableSources } from './snapshot.js';
import { verifySnapshot } from './verify.js';

/** Final fail-closed check immediately before a snapshot can be pushed. */
export function assertPublicationReady(
  files: Map<string, string>,
  registry: Source[],
): void {
  verifySnapshot(files);
  const manifestText = files.get('manifest.json');
  const exceptionsText = files.get('meta/market-exceptions.json');
  if (!manifestText || !exceptionsText)
    throw new Error('Missing manifest or market exceptions');
  const manifest = manifestPublishedSchema.parse(JSON.parse(manifestText));
  if (manifest.fixture)
    throw new Error('Fixture snapshots must never be published');
  const registryById = new Map(registry.map((source) => [source.id, source]));
  if (registryById.size !== registry.length)
    throw new Error('Duplicate source registry id');
  const seen = new Set<string>();
  const used = manifest.sources.map((entry) => {
    if (seen.has(entry.id))
      throw new Error(`Duplicate snapshot source: ${entry.id}`);
    seen.add(entry.id);
    const source = registryById.get(entry.id);
    if (
      !source ||
      !source.redistribution_approved ||
      !source.license_name ||
      !source.license_url ||
      !source.attribution ||
      !source.last_verified_at ||
      !source.schema_fixture
    )
      throw new Error(`Unapproved source: ${entry.id}`);
    if (
      entry.sourceUrl !== source.url ||
      entry.licenseUrl !== source.license_url ||
      entry.attribution !== source.attribution ||
      entry.lastVerifiedAt !== source.last_verified_at
    )
      throw new Error(`Source provenance mismatch: ${entry.id}`);
    return source;
  });
  assertPublishableSources(used);
  const allowed = (category: string, market: string) =>
    used.some(
      (source) =>
        source.category === category &&
        (source.market === market || source.market === 'BOTH'),
    );
  for (const market of ['TWSE', 'TPEX']) {
    if (!allowed('securities', market))
      throw new Error(`Missing approved securities universe for ${market}`);
  }
  const exceptions = publishedSchemas.exceptions.parse(
    JSON.parse(exceptionsText),
  );
  for (const exception of exceptions.data) {
    const market = exception.securityId.split(':')[0];
    const source = used.find((item) => item.id === exception.source);
    if (
      !source ||
      source.category !== 'market_exceptions' ||
      (source.market !== market && source.market !== 'BOTH')
    )
      throw new Error(
        `Missing approved exception source: ${exception.securityId}`,
      );
  }
  const pathCategory: Record<string, string> = {
    quarterly: 'quarterly_financials',
    annual: 'annual_financials',
    revenue: 'monthly_revenues',
    ownership: 'ownership',
    dividends: 'dividends',
  };
  for (const [path, contents] of files) {
    const stockPath = /^stocks\/(TWSE|TPEX)\/[A-Za-z0-9]{2,12}\.json$/.exec(
      path,
    );
    if (stockPath) {
      const stock = publishedSchemas.stock.parse(JSON.parse(contents));
      const market = stockPath[1];
      if (
        stock.daily.some((day) =>
          Object.values(day.institutionalNetShares).some(
            (value) => value !== null,
          ),
        ) &&
        !allowed('daily_institutional', market)
      )
        throw new Error(`Missing institutional source for ${market}`);
      if (
        stock.daily.some(
          (day) => day.margin !== undefined && day.margin !== null,
        ) &&
        !allowed('daily_margin', market)
      )
        throw new Error(`Missing margin source for ${market}`);
      if (
        [
          stock.latest.per,
          stock.latest.pbr,
          stock.latest.dividendYieldPct,
        ].some((value) => value !== null) &&
        !allowed('daily_valuation', market)
      )
        throw new Error(`Missing valuation source for ${market}`);
      if (
        [stock.latest.epsTtm, stock.latest.roePct].some(
          (value) => value !== null,
        ) &&
        !allowed('quarterly_financials', market)
      )
        throw new Error(`Missing financial source for ${market}`);
      if (
        stock.latest.revenueYoyPct !== null &&
        !allowed('monthly_revenues', market)
      )
        throw new Error(`Missing revenue source for ${market}`);
      const metricCategories: Record<string, string> = {
        per: 'daily_valuation',
        pbr: 'daily_valuation',
        dividendYieldPct: 'daily_valuation',
        epsTtm: 'quarterly_financials',
        roePct: 'quarterly_financials',
        revenueYoyPct: 'monthly_revenues',
      };
      for (const [metric, value] of Object.entries(stock.latest)) {
        if (value === null) continue;
        const metadata = stock.latestProvenance[metric];
        const source = used.find((item) => item.id === metadata?.source);
        if (
          !metadata ||
          !source ||
          source.category !== metricCategories[metric] ||
          (source.market !== market && source.market !== 'BOTH') ||
          (manifest.latestTradingDate &&
            metadata.asOfDate > manifest.latestTradingDate)
        )
          throw new Error(`Missing metric provenance: ${path} ${metric}`);
      }
    }
    const match =
      /^(?:fundamentals\/(quarterly|annual|revenue)|(ownership|dividends))\/(TWSE|TPEX)\/[A-Za-z0-9]{2,12}\.json$/.exec(
        path,
      );
    if (!match) continue;
    const kind = match[1] || match[2];
    const market = match[3];
    const parsed = publishedSchemas[
      kind as 'quarterly' | 'annual' | 'revenue' | 'ownership' | 'dividends'
    ].parse(JSON.parse(contents));
    for (const row of parsed.data) {
      const source = used.find((item) => item.id === row.source);
      if (
        !source ||
        source.category !== pathCategory[kind] ||
        (source.market !== market && source.market !== 'BOTH')
      )
        throw new Error(`Missing approved provenance: ${path}`);
      if (!row.asOfDate) throw new Error(`Missing source date: ${path}`);
      if (
        ['quarterly', 'annual', 'revenue'].includes(kind) &&
        (!('sourceUnit' in row) || !row.sourceUnit)
      )
        throw new Error(`Missing source unit: ${path}`);
    }
  }
}
