import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { publishedSchemas } from './published.js';

const output = 'schemas/1.0.0';
mkdirSync(output, { recursive: true });
for (const [name, schema] of Object.entries(publishedSchemas)) {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  writeFileSync(
    join(output, `${name}.schema.json`),
    `${JSON.stringify(jsonSchema, null, 2)}\n`,
  );
}
