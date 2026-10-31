import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod/v4';
import { inputSchema, sourceSchema } from './contracts.js';
import {
  assertPublishableSources,
  createSnapshot,
  canonicalJson,
} from './snapshot.js';
import { assertPublicationReady } from './approval.js';
import { publishSnapshot } from './publish.js';
import { notifyWebCache } from './notify.js';
import { collectProduction } from './production.js';
import { verifiedCalendarSchema } from './providers/exchange-calendar.js';
import {
  gitEnvironment,
  loadRemoteSnapshot,
  readSnapshotDirectory,
} from './remote.js';
import { verifySnapshot } from './verify.js';

const [mode, ...argv] = process.argv.slice(2);
if (!['fixture', 'build', 'publish', 'verify'].includes(mode ?? ''))
  throw new Error(
    'Usage: cli.ts fixture|build|publish|verify [--target-date YYYY-MM-DD] [--force-refresh]',
  );
if (mode === 'verify') {
  const files = readSnapshotDirectory(argv[0] ?? 'staging/snapshot');
  verifySnapshot(files);
  console.log(
    JSON.stringify({ stage: 'verify', files: files.size, status: 'valid' }),
  );
} else if (mode === 'fixture') {
  const input = inputSchema.parse(
    JSON.parse(readFileSync(argv[0] ?? 'tests/fixtures/snapshot.json', 'utf8')),
  );
  const snapshot = createSnapshot(input, { fixture: true });
  const outputDir = argv[1] ?? 'staging/snapshot';
  for (const [path, contents] of snapshot) {
    const target = join(outputDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  console.log(
    JSON.stringify({
      snapshotId: input.snapshotId,
      files: snapshot.size,
      outputDir,
      fixture: true,
    }),
  );
} else {
  const started = performance.now();
  const config = z
    .object({ sources: z.array(sourceSchema) })
    .parse(parse(readFileSync('config/sources.yml', 'utf8')));
  assertPublishableSources(config.sources);
  const calendar = verifiedCalendarSchema.parse(
    JSON.parse(readFileSync('config/market-calendar.json', 'utf8')),
  );
  const repository =
    process.env.GITHUB_REPOSITORY ??
    process.env.DATA_REPOSITORY ??
    'ntustRay/engineer-stock-data';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error('Invalid data repository');
  const remote = `https://github.com/${repository}.git`,
    branch = process.env.DATA_BRANCH ?? 'data';
  const previous = loadRemoteSnapshot(remote, branch);
  const targetIndex = argv.indexOf('--target-date');
  const targetDate = targetIndex >= 0 ? argv[targetIndex + 1] : undefined;
  if (targetIndex >= 0 && !targetDate)
    throw new Error('--target-date requires a date');
  const input = await collectProduction({
    registry: config.sources,
    calendar,
    previous: previous.input,
    targetDate,
  });
  if (!input) {
    console.log(
      JSON.stringify({ stage: 'skip', reason: 'non_trading_day', targetDate }),
    );
    process.exit(0);
  }
  if (previous.input && !argv.includes('--force-refresh')) {
    const semantic = (value: typeof input) =>
      canonicalJson({ ...value, snapshotId: null });
    if (semantic(previous.input) === semantic(input)) {
      console.log(
        JSON.stringify({
          stage: 'skip',
          reason: 'unchanged',
          snapshotId: previous.input.snapshotId,
          commitSha: previous.sha,
        }),
      );
      process.exit(0);
    }
  }
  const snapshot = createSnapshot(input);
  assertPublicationReady(snapshot, config.sources);
  const outputDir = 'staging/snapshot';
  rmSync(outputDir, { recursive: true, force: true });
  for (const [path, contents] of snapshot) {
    const target = join(outputDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  let commitSha = previous.sha,
    cacheNotified = false;
  if (mode === 'publish') {
    commitSha = publishSnapshot(
      snapshot,
      remote,
      branch,
      previous.sha,
      config.sources,
      gitEnvironment(),
    );
    if (process.env.CACHE_WEBHOOK_URL && process.env.CACHE_WEBHOOK_SECRET) {
      try {
        cacheNotified = await notifyWebCache({
          url: process.env.CACHE_WEBHOOK_URL,
          secret: process.env.CACHE_WEBHOOK_SECRET,
          commitSha,
        });
      } catch {
        cacheNotified = false;
      }
      if (!cacheNotified)
        console.warn(
          'Cache notification failed; the website refreshes by the 15-minute TTL.',
        );
    }
  }
  const manifest = JSON.parse(snapshot.get('manifest.json') ?? '{}');
  const summary = {
    stage: mode,
    snapshotId: input.snapshotId,
    asOfDate: input.asOfDate,
    commitSha,
    files: snapshot.size,
    securities: input.stocks.length,
    bytes: [...snapshot.values()].reduce(
      (sum, text) => sum + Buffer.byteLength(text),
      0,
    ),
    unavailableDatasets: Object.entries(manifest.datasets)
      .filter(
        ([, v]) =>
          z.object({ status: z.string() }).parse(v).status === 'unavailable',
      )
      .map(([key]) => key),
    cacheNotified,
    ms: Math.round(performance.now() - started),
  };
  console.log(JSON.stringify(summary));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`,
    );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `snapshot_id=${input.snapshotId}\ncommit_sha=${commitSha}\n`,
    );
}
