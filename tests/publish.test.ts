import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { publishSnapshot } from '../src/publish.js';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
describe('orphan publishing', () => {
  it('replaces data with a parentless commit and rejects unsafe paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stock-publish-test-'));
    try {
      const remote = join(dir, 'remote.git');
      git(dir, 'init', '--bare', '-q', remote);
      const first = publishSnapshot(
        new Map([['manifest.json', '{"version":1}']]),
        remote,
      );
      const second = publishSnapshot(
        new Map([['manifest.json', '{"version":2}']]),
        remote,
      );
      expect(second).not.toBe(first);
      expect(
        git(
          remote,
          'rev-list',
          '--parents',
          '-n',
          '1',
          'refs/heads/data',
        ).split(' '),
      ).toHaveLength(1);
      expect(() => publishSnapshot(new Map([['../bad', 'x']]), remote)).toThrow(
        /Invalid output path/,
      );
      expect(git(remote, 'rev-parse', 'refs/heads/data')).toBe(second);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
