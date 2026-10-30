import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

// The pages of one live run, frozen in cache/pages.json by seed.ts. The
// repository keeps no publisher text, so the answer key names each page by
// its URL and the sha256 of its text, and its spans index into that text.
export const cache = join(import.meta.dirname, 'cache', 'pages.json');

const pageSchema = z.object({
  url: z.string(),
  title: z.string(),
  list: z.string(),
  loadedAt: z.string(),
  sha256: z.string(),
  text: z.string(),
});
export type Page = z.infer<typeof pageSchema>;

export function pages(): ReadonlyMap<string, Page> {
  const all = z
    .array(pageSchema)
    .parse(JSON.parse(readFileSync(cache, 'utf8')));
  return new Map(all.map((page) => [page.url, page]));
}
