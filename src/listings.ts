import type { SnapshotInput, StockInput } from './contracts.js';
import { parseDate } from './normalize.js';
import type { normalizeSecurities } from './providers/securities.js';

type Listing = ReturnType<typeof normalizeSecurities>[number];
type Delisting = {
  Code: string;
  Company?: string | null;
  DelistingDate: string;
};

/** A public venue/code can be reassigned. Never merge a known different issuer. */
export function reconcileIssuers(
  previous: SnapshotInput | null,
  universe: Listing[],
  targetDate: string,
) {
  const issuerChanges = new Map<string, string>();
  if (!previous) return { previous, issuerChanges };
  const byId = new Map(
    universe.map((item) => [item.security.securityId, item.listing]),
  );
  const stocks = previous.stocks.filter((stock) => {
    const id = stock.security.securityId;
    const listing = byId.get(id);
    if (!listing) return true;
    const prior = stock.listing;
    const changedIssuer =
      prior?.issuerId &&
      listing.issuerId &&
      listing.issuerId !== prior.issuerId;
    const relisted =
      stock.security.status === 'delisted' &&
      listing.listedAt > previous.asOfDate;
    if (changedIssuer || relisted) {
      const start =
        listing.listedAt > previous.asOfDate ? listing.listedAt : targetDate;
      issuerChanges.set(id, start);
      console.warn(
        JSON.stringify({
          stage: 'security-lifecycle',
          securityId: id,
          status: 'issuer-changed',
          start,
        }),
      );
      return false;
    }
    if (prior?.issuerChangedAt) issuerChanges.set(id, prior.issuerChangedAt);
    if (
      prior?.issuerId &&
      !listing.issuerId &&
      listing.listedAt === prior.listedAt
    ) {
      listing.issuerId = prior.issuerId;
    }
    return true;
  });
  return { previous: { ...previous, stocks }, issuerChanges };
}

export function requiresDailyQuote(
  stock: Pick<StockInput, 'security' | 'listing'>,
  date: string,
) {
  return (
    stock.security.status === 'active' &&
    !stock.listing?.missingAfter &&
    stock.listing?.listedAt !== date
  );
}

/** Keep venue identities separate. Only retire the old identity on dated evidence. */
export async function retainMissingListings(
  previous: SnapshotInput | null,
  universe: Listing[],
  targetDate: string,
  quotedIds: Set<string>,
  getTwseDelistings: () => Promise<Delisting[]>,
): Promise<StockInput[]> {
  if (!previous) return [];
  const byId = new Map(
    universe.map((item) => [item.security.securityId, item]),
  );
  const missing = previous.stocks.filter(
    ({ security }) =>
      security.status !== 'delisted' && !byId.has(security.securityId),
  );
  if (!missing.length) return [];
  const former = new Map(
    previous.stocks.map((stock) => [stock.security.securityId, stock]),
  );
  let delistings: Delisting[] = [];
  if (missing.some(({ security }) => security.market === 'TWSE')) {
    try {
      delistings = await getTwseDelistings();
    } catch (error) {
      console.warn(
        JSON.stringify({
          stage: 'delisting-evidence',
          status: 'unavailable',
          reason: error instanceof Error ? error.message : 'Source unavailable',
        }),
      );
    }
  }
  const newlyMissing = { TWSE: 0, TPEX: 0 };
  const retained = missing.map((stock): StockInput => {
    const { security, listing } = stock;
    const missingAfter = listing?.missingAfter ?? previous.asOfDate;
    const otherMarket = security.market === 'TWSE' ? 'TPEX' : 'TWSE';
    const destination = byId.get(`${otherMarket}:${security.symbol}`);
    const formerDestination =
      destination && former.get(destination.security.securityId);
    const lastOriginTrade = stock.daily
      .filter((day) => day.close !== null && day.volumeShares !== null)
      .at(-1)?.date;
    const overlappingMasters =
      destination &&
      lastOriginTrade &&
      lastOriginTrade < destination.listing.listedAt &&
      formerDestination?.listing?.issuerId === destination.listing.issuerId &&
      formerDestination.daily.some(
        (day) =>
          day.date >= destination.listing.listedAt &&
          day.close !== null &&
          day.volumeShares !== null,
      );
    const transferred =
      destination &&
      listing?.issuerId &&
      destination.listing.issuerId === listing.issuerId &&
      (missingAfter < destination.listing.listedAt || overlappingMasters) &&
      quotedIds.has(destination.security.securityId);
    const dates = new Set<string>();
    if (security.market === 'TWSE') {
      for (const row of delistings) {
        if (
          row.Code.trim() !== security.symbol ||
          (row.Company && row.Company.trim() !== security.name)
        )
          continue;
        try {
          const date = parseDate(row.DelistingDate);
          if (missingAfter < date && date <= targetDate) dates.add(date);
        } catch {
          console.warn(
            JSON.stringify({
              stage: 'delisting-evidence',
              securityId: security.securityId,
              status: 'invalid-date',
            }),
          );
        }
      }
    }
    const retired = Boolean(transferred) || dates.size === 1;
    if (!retired && !listing?.missingAfter) newlyMissing[security.market]++;
    console.info(
      JSON.stringify({
        stage: 'security-lifecycle',
        securityId: security.securityId,
        missingAfter,
        status: transferred
          ? 'transferred'
          : retired
            ? 'delisted'
            : 'awaiting-evidence',
      }),
    );
    return {
      ...stock,
      security: retired ? { ...security, status: 'delisted' } : security,
      listing: {
        ...listing,
        issuerId: listing?.issuerId ?? null,
        listedAt: listing?.listedAt ?? null,
        missingAfter: retired ? null : missingAfter,
      },
    };
  });
  for (const market of ['TWSE', 'TPEX'] as const) {
    const lastRosterSize = previous.stocks.filter(
      (s) =>
        s.security.market === market &&
        s.security.status !== 'delisted' &&
        !s.listing?.missingAfter,
    ).length;
    if (newlyMissing[market] > Math.max(1, Math.floor(lastRosterSize * 0.01)))
      throw new Error(
        `Unexpected ${market} roster loss: ${newlyMissing[market]}/${lastRosterSize}`,
      );
  }
  return retained;
}
