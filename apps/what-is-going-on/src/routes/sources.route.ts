import type { Hono } from 'hono';
import { z } from 'zod';

import db from '../db.ts';
import events from '../events.ts';
import { leftOut } from '../sources.ts';
import { controlsSchema } from '../views/controls.ts';
import { layout } from '../views/layout.ts';
import { age } from '../views/line.ts';
import { markup } from '../views/markup.ts';

const sourceSchema = z.object({
  site: z.string(),
  name: z.string(),
  kind: z.enum(['lab', 'outlet']),
  feed: z.string().nullable(),
});

// The sources the running pipeline reads, as its last refresh recorded them.
const read = () =>
  db.prepare(`SELECT 1 FROM sqlite_schema WHERE name = 'source'`).get() ===
  undefined
    ? []
    : db
        .prepare(
          'SELECT site, name, kind, feed FROM source ORDER BY name, site',
        )
        .all()
        .map((row) => sourceSchema.parse(row));

export default function (router: Hono) {
  router.get('/sources', (c) => {
    const sources = read();
    const newest = events.newest();
    const outlets = [
      ...new Set(
        sources.filter(({ kind }) => kind === 'outlet').map(({ name }) => name),
      ),
    ];
    return c.html(
      layout({
        title: 'Sources - What is going on',
        hours: controlsSchema.hours.parse(undefined),
        main: markup`<div class="about"><h3>Labs</h3><ul>${sources
          .filter(({ kind }) => kind === 'lab')
          .map(({ site, name, feed }) => {
            const at = newest.get(name);
            return markup`<li><a href="${site}">${name}</a> [${feed === null ? 'blog page re-read (no feed)' : 'feed'}]${
              at === undefined ? '' : ` ${age(at)}`
            }</li>`;
          })}</ul><h3>Outlets</h3><p>${outlets.join(' | ')}</p><h3>Left out</h3><ul>${leftOut.map(
          ({ name, reason }) => markup`<li>${name} [${reason}]</li>`,
        )}</ul></div>`,
      }),
    );
  });
}
