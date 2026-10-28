import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { inputSchema, sourceSchema, type Source } from './contracts.js';
import { assertPublishableSources, createSnapshot } from './snapshot.js';
import { publishSnapshot } from './publish.js';
import { notifyWebCache } from './notify.js';
import { z } from 'zod/v4';

const [
  mode,
  inputPath = 'tests/fixtures/snapshot.json',
  outputDir = 'staging/snapshot',
] = process.argv.slice(2);
if (!['fixture', 'build', 'publish'].includes(mode ?? ''))
  throw new Error(
    'Usage: cli.ts fixture|build|publish [input.json] [output-dir]',
  );
const fixture = mode === 'fixture';
function requireProductionReadiness(isFixture: boolean): void {
  if (!isFixture)
    throw new Error(
      'Production ingestion and provenance are not implemented; refusing to build or publish.',
    );
}
requireProductionReadiness(fixture);
let sources: Source[] = [];
if (!fixture) {
  const config = z
    .object({ sources: z.array(sourceSchema) })
    .parse(parse(readFileSync('config/sources.yml', 'utf8')));
  assertPublishableSources(config.sources);
  sources = config.sources;
}
const input = inputSchema.parse(JSON.parse(readFileSync(inputPath, 'utf8')));
const snapshot = createSnapshot(input, { fixture });
if (mode === 'publish') {
  const remote = process.env.DATA_GIT_REMOTE;
  if (!remote) throw new Error('DATA_GIT_REMOTE is required');
  const expectedSha = process.env.DATA_EXPECTED_SHA;
  if (expectedSha === undefined)
    throw new Error('DATA_EXPECTED_SHA is required');
  const sha = publishSnapshot(
    snapshot,
    remote,
    process.env.DATA_BRANCH ?? 'data',
    expectedSha,
    sources,
  );
  let cacheNotified = false;
  if (process.env.CACHE_WEBHOOK_URL && process.env.CACHE_WEBHOOK_SECRET) {
    try {
      cacheNotified = await notifyWebCache({
        url: process.env.CACHE_WEBHOOK_URL,
        secret: process.env.CACHE_WEBHOOK_SECRET,
        commitSha: sha,
      });
    } catch {
      /* A failed notification never rolls back an already published snapshot. */
    }
    if (!cacheNotified)
      console.warn(
        'Cache notification failed; the web cache will refresh by TTL.',
      );
  }
  console.log(
    JSON.stringify({
      snapshotId: input.snapshotId,
      commitSha: sha,
      files: snapshot.size,
      cacheNotified,
    }),
  );
} else {
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
      fixture,
    }),
  );
}
