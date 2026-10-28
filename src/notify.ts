import { createHmac } from 'node:crypto';

/** Notify the web cache after publication; callers treat failure as non-fatal. */
export async function notifyWebCache(args: {
  url: string;
  secret: string;
  commitSha: string;
  now?: number;
  fetchImpl?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}): Promise<boolean> {
  const url = new URL(args.url);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Cache webhook must be an HTTPS URL without credentials');
  if (args.secret.length < 32 || !/^[a-f0-9]{40}$/.test(args.commitSha))
    throw new Error('Invalid webhook configuration');
  const timestamp = Math.floor((args.now ?? Date.now()) / 1000).toString();
  const body = JSON.stringify({ commitSha: args.commitSha });
  const signature = createHmac('sha256', args.secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const response = await (args.fetchImpl ?? fetch)(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      'x-stock-timestamp': timestamp,
      'x-stock-signature': signature,
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  return response.ok;
}
