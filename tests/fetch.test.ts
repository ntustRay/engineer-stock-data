import { describe, it, expect } from 'bun:test';
import { z } from 'zod/v4';
import { fetchApprovedJson } from '../src/fetch.js';
import type { Source } from '../src/contracts.js';
const source: Source = {
  id: 'twse.test',
  provider: 'twse',
  url: 'https://openapi.twse.com.tw/v1/test',
  category: 'daily_price',
  market: 'TWSE',
  frequency: 'trading_day',
  license_name: 'test',
  license_url: 'https://example.com/license',
  redistribution_approved: true,
  attribution: 'Example source attribution',
  schema_fixture: 'test.json',
  last_verified_at: '2026-10-28',
};
describe('approved source fetching', () => {
  it('refuses unapproved or non-allowlisted URLs', async () => {
    await expect(
      fetchApprovedJson(
        { ...source, redistribution_approved: false },
        z.unknown(),
      ),
    ).rejects.toThrow(/not approved/);
    await expect(
      fetchApprovedJson(
        { ...source, url: 'https://evil.example/data' },
        z.unknown(),
      ),
    ).rejects.toThrow(/allowlist/);
  });
  it('retries transient failures and validates response', async () => {
    let calls = 0;
    const fake = async () => {
      calls++;
      return calls < 3
        ? new Response('', { status: 503 })
        : new Response('[{"code":"9001"}]', {
            headers: { 'content-type': 'application/json' },
          });
    };
    expect(
      await fetchApprovedJson(source, z.array(z.object({ code: z.string() })), {
        fetchImpl: fake,
        sleep: async () => {},
      }),
    ).toEqual([{ code: '9001' }]);
    expect(calls).toBe(3);
  });
  it('rejects changed schemas and oversized responses', async () => {
    const fake = async () =>
      new Response('[{"unexpected":1}]', {
        headers: { 'content-type': 'application/json' },
      });
    await expect(
      fetchApprovedJson(source, z.array(z.object({ code: z.string() })), {
        fetchImpl: fake,
      }),
    ).rejects.toThrow();
    await expect(
      fetchApprovedJson(source, z.unknown(), { fetchImpl: fake, maxBytes: 2 }),
    ).rejects.toThrow(/maximum/);
  });
});
