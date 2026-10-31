import { loadRemoteSnapshot } from './remote.js';
const repository =
  process.env.GITHUB_REPOSITORY ?? 'ntustRay/engineer-stock-data';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
  throw new Error('Invalid repository');
const { sha, input } = loadRemoteSnapshot(
  `https://github.com/${repository}.git`,
  'data',
);
if (!input) throw new Error('No published data snapshot');
console.log(
  JSON.stringify({
    status: 'verified',
    commitSha: sha,
    snapshotId: input.snapshotId,
    securities: input.stocks.length,
    asOfDate: input.asOfDate,
  }),
);
