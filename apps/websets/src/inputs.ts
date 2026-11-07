import { z } from 'zod';

// The validators of single input fields that the routes share or that read
// better under a name; each route writes its own input inline from them,
// never a schema of a whole operation. openapi.ts gives this module to
// sdk-it as `inputs`, so the routes' `against` resolve in the spec.

// What a criterion or a field asks, in words a model reads.
export const description = z.string().trim().min(1).max(1000);

// What a web search looks for.
export const searchQuery = z.string().trim().min(1).max(5000);

// A web search that a dataset or a monitor runs: what it looks for, and how
// many pages it lists, 10 unless it asks, at most 50.
export const search = z.object({
  query: searchQuery,
  count: z.number().int().min(1).max(50).default(10),
});

// A page to read, or a list whose links are the pages to read.
export const webUrl = z.url({ protocol: /^https?$/u });

const name = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/u);

// A field that the API extracts from every item, in the formats of Exa's
// enrichments: text, a number, a date, a URL, or one of the given options.
export const field = z.discriminatedUnion('format', [
  z.object({ name, description, format: z.literal('text') }),
  z.object({ name, description, format: z.literal('number') }),
  z.object({ name, description, format: z.literal('date') }),
  z.object({ name, description, format: z.literal('url') }),
  z.object({
    name,
    description,
    format: z.literal('options'),
    options: z.array(z.string().trim().min(1).max(200)).min(2).max(150),
  }),
]);
