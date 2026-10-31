import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Source } from './contracts.js';
import { assertPublicationReady } from './approval.js';

const git = (
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
export function publishSnapshot(
  files: Map<string, string>,
  remote: string,
  branch: string,
  expectedSha: string,
  registry: Source[],
  gitEnv: NodeJS.ProcessEnv = process.env,
): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..'))
    throw new Error('Invalid branch');
  if (expectedSha !== '' && !/^[a-f0-9]{40}$/.test(expectedSha))
    throw new Error('Expected snapshot SHA is required');
  assertPublicationReady(files, registry);
  const dir = mkdtempSync(join(tmpdir(), 'stock-snapshot-'));
  try {
    git(dir, ['init', '-q'], gitEnv);
    git(dir, ['remote', 'add', 'origin', remote], gitEnv);
    for (const [path, content] of files) {
      if (path.startsWith('/') || path.split('/').includes('..'))
        throw new Error('Invalid output path');
      const dest = join(dir, path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
    git(dir, ['add', '--all'], gitEnv);
    const tree = git(dir, ['write-tree'], gitEnv);
    const authorEnv = {
      ...gitEnv,
      GIT_AUTHOR_NAME: 'Stock data pipeline',
      GIT_AUTHOR_EMAIL: 'stock-data@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'Stock data pipeline',
      GIT_COMMITTER_EMAIL: 'stock-data@users.noreply.github.com',
    };
    const commit = git(
      dir,
      ['commit-tree', tree, '-m', 'Publish stock data snapshot'],
      authorEnv,
    );
    git(
      dir,
      [
        'push',
        `--force-with-lease=refs/heads/${branch}:${expectedSha}`,
        'origin',
        `${commit}:refs/heads/${branch}`,
      ],
      gitEnv,
    );
    return commit;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
