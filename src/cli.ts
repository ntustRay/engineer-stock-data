import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { inputSchema, sourceSchema } from './contracts.js';
import { assertPublishableSources, createSnapshot } from './snapshot.js';
import { publishSnapshot } from './publish.js';
import { z } from 'zod';

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
if (!fixture) {
  const config = z
    .object({ sources: z.array(sourceSchema) })
    .parse(parse(readFileSync('config/sources.yml', 'utf8')));
  assertPublishableSources(config.sources);
}
const input = inputSchema.parse(JSON.parse(readFileSync(inputPath, 'utf8')));
const snapshot = createSnapshot(input, { fixture });
if (mode === 'publish') {
  const remote = process.env.DATA_GIT_REMOTE;
  if (!remote) throw new Error('DATA_GIT_REMOTE is required');
  const sha = publishSnapshot(
    snapshot,
    remote,
    process.env.DATA_BRANCH ?? 'data',
  );
  console.log(
    JSON.stringify({
      snapshotId: input.snapshotId,
      commitSha: sha,
      files: snapshot.size,
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
