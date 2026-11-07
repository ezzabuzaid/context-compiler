import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { analyze } from '@sdk-it/generic';
import { responseAnalyzer } from '@sdk-it/hono';
import { generate } from '@sdk-it/typescript';

const app = import.meta.dirname;
const specPath = join(app, 'openapi.json');
const client = join(app, '../../packages/websets-client/src');

// Every error answers in one shape: app.ts's error handler writes it, and
// bearerAuth writes it for a missing or wrong key. The analyzer reads only
// the routes, so it sees neither.
const apiError = {
  description: 'An error, in the shape that every error of the API has',
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
  },
};

const { paths, components, tags } = await analyze(
  join(app, 'tsconfig.lib.json'),
  {
    responseAnalyzer,
    // The routes write each input inline from these validators.
    imports: [{ import: 'inputs', from: join(app, 'src/inputs.ts') }],
    onOperation: (_source, _method, _path, operation) => {
      const responses = operation.responses ?? {};
      for (const status of Object.keys(responses)) {
        if (Number(status) >= 400) {
          responses[status] = apiError;
        }
      }
      responses[401] = apiError;
      responses[500] = apiError;
      operation.responses = responses;
      return {};
    },
  },
);

// The analyzer's schemas of sdk-it's own validation errors are left with no
// reference once every error answers as ApiError.
const references = JSON.stringify({ paths, components });
const schemas = Object.fromEntries(
  Object.entries(components.schemas ?? {}).filter(([name]) =>
    references.includes(`"#/components/schemas/${name}"`),
  ),
);

const spec = {
  openapi: '3.1.0',
  info: { title: 'Websets', version: '0.1.0' },
  // main.ts's default port, so an imported spec has its host.
  servers: [{ url: 'http://localhost:4340' }],
  tags: tags.map((name) => ({ name })),
  security: [{ bearer: [] }],
  paths,
  components: {
    ...components,
    schemas: {
      ...schemas,
      ApiError: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                description:
                  'invalid_argument, invalid_cursor, unauthenticated, not_found, crawl_running, resync_required or internal',
              },
              message: { type: 'string' },
              detail: {
                description:
                  'For an invalid input, the errors of each field under fields.',
              },
            },
          },
        },
      },
    },
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
  },
} satisfies Parameters<typeof generate>[0];

await writeFile(specPath, JSON.stringify(spec, null, 2));

await generate(spec, {
  mode: 'minimal',
  output: client,
  name: 'Websets',
  readme: false,
  pagination: false,
  formatCode: async ({ output, env }) => {
    await promisify(execFile)('prettier', ['--write', specPath, output], {
      env,
    });
  },
});
