import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { inputSchema } from '../src/contracts.js';
import { createSnapshot, assertPublishableSources } from '../src/snapshot.js';
import { verifySnapshot } from '../src/verify.js';
import { loadSnapshot } from '../src/load-snapshot.js';
import { manifestPublishedSchema } from '../src/published.js';
const input = () =>
  inputSchema.parse(
    JSON.parse(readFileSync('tests/fixtures/snapshot.json', 'utf8')),
  );
describe('snapshot', () => {
  it('is deterministic and verifies file hashes', async () => {
    const a = createSnapshot(input(), { fixture: true });
    const b = createSnapshot(input(), { fixture: true });
    expect([...a]).toEqual([...b]);
    const { createHash } = await import('node:crypto');
    const manifestText = a.get('manifest.json');
    if (!manifestText) throw new Error('Missing manifest');
    const manifest = manifestPublishedSchema.parse(JSON.parse(manifestText));
    for (const [path, m] of Object.entries(manifest.files)) {
      const content = a.get(path);
      if (!content) throw new Error(`Missing ${path}`);
      expect(createHash('sha256').update(content).digest('hex')).toBe(m.sha256);
      expect(Buffer.byteLength(content)).toBe(m.bytes);
    }
  });
  it('rejects incomplete market coverage', () => {
    const v = input();
    v.stocks[1].daily = [];
    expect(() => createSnapshot(v)).toThrow(/coverage/);
  });
  it('rejects duplicate security and invalid OHLC', () => {
    const v = input();
    v.stocks.push(v.stocks[0]);
    expect(() => createSnapshot(v)).toThrow(/Duplicate security/);
    const w = input();
    w.stocks[0].daily[0].high = 1;
    expect(() => createSnapshot(w)).toThrow();
  });
  it('never publishes unapproved sources', () =>
    expect(() => assertPublishableSources([])).toThrow(/approved/));
  it('detects tampered data and unexpected files', () => {
    const files = createSnapshot(input(), { fixture: true });
    files.set('index/screener.json', '{}');
    expect(() => verifySnapshot(files)).toThrow(/integrity/);
    const extra = createSnapshot(input(), { fixture: true });
    extra.set('unexpected.json', '{}');
    expect(() => verifySnapshot(extra)).toThrow(/count/);
  });
  it('reconstructs the previous validated snapshot without losing low-frequency data', () => {
    const source = input();
    source.stocks[0].revenues = [{ period: '2026-09', revenue: 1234 }];
    source.stocks[0].financials = [{ period: '2026-Q2', eps: 1.2 }];
    const original = createSnapshot(source, { fixture: true });
    const loaded = loadSnapshot(original);
    const again = createSnapshot(loaded, { fixture: true });
    expect([...again]).toEqual([...original]);
    original.set('index/screener.json', '{}');
    expect(() => loadSnapshot(original)).toThrow(/integrity/);
  });
  it('retains only 30 calendar days', () => {
    const v = input();
    v.stocks[0].daily.unshift({ ...v.stocks[0].daily[0], date: '2026-09-26' });
    const files = createSnapshot(v);
    expect(files.has('daily/2026/09/2026-09-26.json')).toBe(false);
  });
});
