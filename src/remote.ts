import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadSnapshot } from './load-snapshot.js';

export function gitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (env.GITHUB_TOKEN) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env.GITHUB_TOKEN}`).toString('base64')}`;
  }
  return env;
}
export function readSnapshotDirectory(root: string): Map<string, string> {
  const files = new Map<string, string>();
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.json'))
        files.set(
          relative(root, path).replaceAll('\\', '/'),
          readFileSync(path, 'utf8'),
        );
      else throw new Error('Unexpected snapshot file');
    }
  }
  visit(root);
  return files;
}
export function loadRemoteSnapshot(
  remote: string,
  branch: string,
  env = gitEnvironment(),
) {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..'))
    throw new Error('Invalid data branch');
  const git = (cwd: string, args: string[]) =>
    execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: 25 * 1024 * 1024,
    }).trim();
  const dir = mkdtempSync(join(tmpdir(), 'stock-previous-'));
  try {
    const ref = git(dir, [
      'ls-remote',
      '--heads',
      remote,
      `refs/heads/${branch}`,
    ]);
    if (!ref) return { sha: '', input: null };
    const sha = ref.split(/\s/)[0];
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid remote SHA');
    git(dir, ['init', '-q']);
    git(dir, ['remote', 'add', 'origin', remote]);
    git(dir, ['fetch', '--depth=1', 'origin', sha]);
    if (/^parent /m.test(git(dir, ['cat-file', '-p', sha])))
      throw new Error(
        'The data branch must contain a parentless snapshot commit',
      );
    git(dir, ['checkout', '--detach', sha]);
    return { sha, input: loadSnapshot(readSnapshotDirectory(dir)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
