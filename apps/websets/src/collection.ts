import { z } from 'zod';

const name = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/u);
const description = z.string().trim().min(1).max(1000);
const url = z.url({ protocol: /^https?$/u });

// A field that the API extracts from every item, in the formats of Exa's
// enrichments: text, a number, a date, a URL, or one of the given options.
const fieldSchema = z.discriminatedUnion('format', [
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
export type Field = z.infer<typeof fieldSchema>;

// What a consumer asks: the pages that meet every criterion, found by a web
// search, given as pages, or linked from lists, each with the fields to
// extract, as Exa's Websets take a search with criteria, imports and
// enrichments. A monitor searches again on a cron, at most once a day.
export const collectionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    search: z
      .object({
        query: z.string().trim().min(1).max(5000),
        count: z.number().int().min(1).max(50).default(10),
      })
      .optional(),
    criteria: z.array(z.object({ description })).min(1).max(5),
    pages: z.array(url).max(1000).default([]),
    lists: z.array(url).max(100).default([]),
    fields: z
      .array(fieldSchema)
      .max(10)
      .default([])
      .refine(
        (fields) =>
          new Set(fields.map(({ name: field }) => field)).size ===
          fields.length,
        { error: 'Each field needs its own name' },
      ),
    monitor: z.object({ cron: z.string().trim().min(9).max(100) }).optional(),
  })
  .refine(
    ({ search, pages, lists }) =>
      search !== undefined || pages.length > 0 || lists.length > 0,
    { error: 'A collection needs a search, pages or lists' },
  )
  .refine(
    ({ search, monitor }) => monitor === undefined || search !== undefined,
    {
      error: 'A monitor searches again, so it needs a search',
    },
  );
export type Definition = z.infer<typeof collectionSchema>;
