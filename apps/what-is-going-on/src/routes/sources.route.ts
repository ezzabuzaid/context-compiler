import { validate } from '@sdk-it/hono/runtime';
import type { Context, Hono } from 'hono';
import { z } from 'zod';

import db from '../db.ts';
import { SiteError, discoverSite } from '../discover-site.ts';
import events from '../events.ts';
import reading from '../reading.ts';
import settings from '../settings.ts';
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

// The sources the running pipeline reads, as its last refresh recorded them,
// and the sites the user added since.
function read() {
  const recorded =
    db.prepare(`SELECT 1 FROM sqlite_schema WHERE name = 'source'`).get() ===
    undefined
      ? []
      : db
          .prepare(
            'SELECT site, name, kind, feed FROM source ORDER BY name, site',
          )
          .all()
          .map((row) => sourceSchema.parse(row));
  const known = new Set(recorded.map(({ site }) => site));
  return [
    ...recorded,
    ...settings.sites().filter(({ site }) => !known.has(site)),
  ];
}

function page(c: Context, notice?: string) {
  const sources = read();
  const newest = events.newest();
  const outlets = [
    ...new Set(
      sources.filter(({ kind }) => kind === 'outlet').map(({ name }) => name),
    ),
  ];
  return layout({
    title: 'Sources - What is going on',
    hours: controlsSchema.hours.parse(undefined),
    main: markup`<div class="about"><h3>Labs</h3><ul>${sources
      .filter(({ kind }) => kind === 'lab')
      .map(({ site, name, feed }) => {
        const at = newest.get(name);
        return markup`<li><a href="${site}">${name}</a> [${feed === null ? 'blog page re-read (no feed)' : markup`<a href="${feed}">feed</a>`}]${
          at === undefined ? '' : ` ${age(at)}`
        }</li>`;
      })}</ul><h3>Outlets</h3><p>${outlets.join(' | ')}</p><h3>Left out</h3><ul>${leftOut.map(
      ({ name, reason }) => markup`<li>${name} [${reason}]</li>`,
    )}</ul><h3>Add a site</h3>${notice === undefined ? '' : markup`<p>${notice}</p>`}<form method="post" action="/sources"><p><label for="site-url">Blog or feed address</label><br><input id="site-url" name="url" type="url" placeholder="https://" required></p><p><label><input type="radio" name="kind" value="lab" checked> lab</label> <label><input type="radio" name="kind" value="outlet"> outlet</label></p><p><button type="submit">Add</button></p></form></div>`,
  });
}

export default function (router: Hono) {
  router.get('/sources', (c) => c.html(page(c)));

  // Finds how to read the address, keeps it, and reads the sources again.
  router.post(
    '/sources',
    validate((payload) => ({
      url: {
        select: payload.body.url,
        against: z.url({ protocol: /^https?$/ }),
      },
      kind: {
        select: payload.body.kind,
        against: z.enum(['lab', 'outlet']).default('lab'),
      },
    })),
    async (c) => {
      const { url, kind } = c.var.input;
      try {
        const source = await discoverSite(url, kind);
        if (!settings.addSite(source))
          return c.html(page(c, `${source.site} is already a source.`), 409);
        void reading.restart();
        return c.redirect('/sources', 303);
      } catch (error) {
        if (!(error instanceof SiteError)) throw error;
        return c.html(page(c, error.message), 422);
      }
    },
  );
}
