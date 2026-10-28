import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { publishSnapshot } from '../src/publish.js';
import { approvedFixture } from './support/approved-fixture.js';
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
describe('orphan publishing', () => {
  it('replaces data with a parentless commit and rejects unsafe paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stock-publish-test-'));
    try {
      const remote = join(dir, 'remote.git');
      git(dir, 'init', '--bare', '-q', remote);
      const one = approvedFixture();
      const two = approvedFixture('2026-10-27T13:00:00.000Z');
      const first = publishSnapshot(
        one.files,
        remote,
        'data',
        '',
        one.registry,
      );
      const second = publishSnapshot(
        two.files,
        remote,
        'data',
        first,
        two.registry,
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
      expect(() =>
        publishSnapshot(
          new Map([['../bad', 'x']]),
          remote,
          'data',
          second,
          two.registry,
        ),
      ).toThrow(/manifest/i);
      expect(git(remote, 'rev-parse', 'refs/heads/data')).toBe(second);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
