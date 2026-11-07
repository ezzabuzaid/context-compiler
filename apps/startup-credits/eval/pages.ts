import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import type { AnswerKey, Label } from './answer-key.ts';

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

function pages(): ReadonlyMap<string, Page> {
  const all = z
    .array(pageSchema)
    .parse(JSON.parse(readFileSync(cache, 'utf8')));
  return new Map(all.map((page) => [page.url, page]));
}

// The test pages of the answer key, each with its frozen page. The spans of
// a label index into the text that it names by sha256, so a test page that
// the cache lacks or holds with other text stops the script.
export function testPages(key: AnswerKey): { label: Label; page: Page }[] {
  const texts = pages();
  return key.pages.flatMap((label) => {
    if (label.role !== 'test') return [];
    const page = texts.get(label.url);
    if (page?.sha256 !== label.sha256)
      throw new Error(
        `${label.url}: the cache holds other text than the labels`,
      );
    return [{ label, page }];
  });
}
