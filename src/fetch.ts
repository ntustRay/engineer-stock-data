import type { z } from 'zod/v4';
import type { Source } from './contracts.js';
export type FetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  fetchImpl?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  sleep?: (milliseconds: number) => Promise<void>;
};
export async function fetchApprovedJson<T>(
  source: Source,
  schema: z.ZodType<T>,
  options: FetchOptions = {},
): Promise<T> {
  if (
    !source.redistribution_approved ||
    !source.license_name ||
    !source.license_url ||
    !source.attribution ||
    !source.last_verified_at ||
    !source.schema_fixture
  )
    throw new Error(`Source ${source.id} is not approved and verified`);
  const url = new URL(source.url);
  const allowed: Record<string, string[]> = {
    twse: ['openapi.twse.com.tw'],
    tpex: ['www.tpex.org.tw'],
    tdcc: ['openapi.tdcc.com.tw'],
  };
  if (
    url.protocol !== 'https:' ||
    !allowed[source.provider]?.includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error('Source URL is outside provider allowlist');
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024,
    retries = Math.min(3, Math.max(0, options.retries ?? 3)),
    fetchImpl = options.fetchImpl ?? fetch,
    sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
        redirect: 'manual',
        headers: { accept: 'application/json' },
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          await sleep(Math.min(8000, 500 * 2 ** attempt));
          continue;
        }
        throw new Error(`Source HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
      if (!response.headers.get('content-type')?.toLowerCase().includes('json'))
        throw new Error('Source returned non-JSON content');
      if (Number(response.headers.get('content-length') || 0) > maxBytes)
        throw new Error('Source exceeds maximum size');
      if (!response.body) throw new Error('Source response is empty');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error('Source exceeds maximum size');
        }
        chunks.push(value);
      }
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = new TextDecoder('utf-8', { fatal: true })
        .decode(joined)
        .replace(/^\uFEFF/, '');
      return schema.parse(JSON.parse(text));
    } catch (error) {
      if (
        attempt < retries &&
        (error instanceof TypeError ||
          (error instanceof Error &&
            ['TimeoutError', 'AbortError'].includes(error.name)))
      ) {
        await sleep(Math.min(8000, 500 * 2 ** attempt));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Source request failed');
}
