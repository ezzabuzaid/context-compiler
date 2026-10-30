import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import directory from '../src/directory.ts';
import { cache } from './pages.ts';

// Freezes the pages of the app's last run into the cache, one entry for each
// article URL: a page that two lists link is one page.
using database = new DatabaseSync(join(directory, 'credits.sqlite'), {
  readOnly: true,
});
const rows = database
  .prepare(
    'SELECT articleUrl AS url, title, min(listingUrl) AS list, max(loaded_at) AS loadedAt, textContent AS text FROM program_pages GROUP BY articleUrl ORDER BY articleUrl',
  )
  .all();
const frozen = rows.map(({ url, title, list, loadedAt, text }) => {
  const pageText = String(text ?? '');
  return {
    url,
    title,
    list,
    loadedAt,
    sha256: createHash('sha256').update(pageText).digest('hex'),
    text: pageText,
  };
});
mkdirSync(dirname(cache), { recursive: true });
writeFileSync(cache, JSON.stringify(frozen, null, 1));
console.log(`${frozen.length} pages frozen in ${cache}`);
