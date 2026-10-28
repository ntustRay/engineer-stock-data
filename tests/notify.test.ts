import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { notifyWebCache } from '../src/notify.js';

describe('cache notification', () => {
  it('signs the exact timestamp and body and reports the response status', async () => {
    const secret = 'a'.repeat(32);
    const sha = 'b'.repeat(40);
    const fake = async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const timestamp = headers.get('x-stock-timestamp');
      const expected = createHmac('sha256', secret)
        .update(`${timestamp}.${init?.body}`)
        .digest('hex');
      expect(headers.get('x-stock-signature')).toBe(expected);
      return new Response(null, { status: 204 });
    };
    expect(
      await notifyWebCache({
        url: 'https://example.com/api/internal/revalidate',
        secret,
        commitSha: sha,
        now: 1793102400000,
        fetchImpl: fake,
      }),
    ).toBe(true);
  });
  it('rejects insecure URLs and weak secrets', async () => {
    await expect(
      notifyWebCache({
        url: 'http://example.com',
        secret: 'a'.repeat(32),
        commitSha: 'b'.repeat(40),
      }),
    ).rejects.toThrow(/HTTPS/);
    await expect(
      notifyWebCache({
        url: 'https://example.com',
        secret: 'short',
        commitSha: 'b'.repeat(40),
      }),
    ).rejects.toThrow(/configuration/);
  });
});
