import { z } from 'zod';

export const listCollectionsSchema = z.object({}).catchall(z.unknown());
export const createCollectionSchema = z.object({
  criteria: z.array(z.object({ description: z.string() })),
  fields: z
    .array(
      z.union([
        z.object({
          description: z.string(),
          format: z.literal('text').default('text'),
          name: z.string(),
        }),
        z.object({
          description: z.string(),
          format: z.literal('number').default('number'),
          name: z.string(),
        }),
        z.object({
          description: z.string(),
          format: z.literal('date').default('date'),
          name: z.string(),
        }),
        z.object({
          description: z.string(),
          format: z.literal('url').default('url'),
          name: z.string(),
        }),
        z.object({
          description: z.string(),
          format: z.literal('options').default('options'),
          name: z.string(),
          options: z.array(z.string()),
        }),
      ]),
    )
    .optional()
    .default([]),
  lists: z.array(z.url()).optional().default([]),
  monitor: z.object({ cron: z.string() }).optional(),
  pages: z.array(z.url()).optional().default([]),
  search: z
    .object({
      count: z.number().int().min(1).max(50).optional().default(10),
      query: z.string(),
    })
    .optional(),
  title: z.string(),
});
export const getCollectionSchema = z.object({ id: z.string() });
export const deleteCollectionSchema = z.object({ id: z.string() });
