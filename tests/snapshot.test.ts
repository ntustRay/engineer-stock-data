import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { inputSchema } from '../src/contracts.js';
import { createSnapshot, assertPublishableSources } from '../src/snapshot.js';
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
    const manifest = JSON.parse(a.get('manifest.json')!);
    for (const [path, m] of Object.entries(manifest.files) as [
      string,
      { sha256: string; bytes: number },
    ][]) {
      const content = a.get(path)!;
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
  it('retains only 30 calendar days', () => {
    const v = input();
    v.stocks[0].daily.unshift({ ...v.stocks[0].daily[0], date: '2026-09-26' });
    const files = createSnapshot(v);
    expect(files.has('daily/2026/09/2026-09-26.json')).toBe(false);
  });
});
