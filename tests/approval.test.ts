import { describe, expect, it } from 'bun:test';
import { assertPublicationReady } from '../src/approval.js';
import { createSnapshot } from '../src/snapshot.js';
import { approvedFixture } from './support/approved-fixture.js';

describe('publication gate', () => {
  it('accepts only a verified snapshot with approved sources and rejects fixtures', () => {
    const { input, registry, files } = approvedFixture();
    expect(() => assertPublicationReady(files, registry)).not.toThrow();
    expect(() =>
      assertPublicationReady(
        createSnapshot(input, { fixture: true }),
        registry,
      ),
    ).toThrow(/Fixture/);
    expect(() =>
      assertPublicationReady(
        files,
        registry.map((source) => ({
          ...source,
          redistribution_approved: false,
        })),
      ),
    ).toThrow(/Unapproved/);
  });
  it('refuses a populated metric without its approved source and provenance', () => {
    const { input, registry } = approvedFixture();
    input.stocks[0].latest.per = 15;
    expect(() =>
      assertPublicationReady(createSnapshot(input), registry),
    ).toThrow(/valuation source/);
    const valuation = {
      ...registry[0],
      id: 'test.TWSE.valuation',
      category: 'daily_valuation',
    };
    if (
      !valuation.license_url ||
      !valuation.attribution ||
      !valuation.last_verified_at
    )
      throw new Error('Invalid test source');
    input.sources.push({
      id: valuation.id,
      name: valuation.id,
      provider: valuation.provider,
      sourceUrl: valuation.url,
      licenseUrl: valuation.license_url,
      attribution: valuation.attribution,
      lastVerifiedAt: valuation.last_verified_at,
    });
    expect(() =>
      assertPublicationReady(createSnapshot(input), [...registry, valuation]),
    ).toThrow(/metric provenance/);
  });
});
