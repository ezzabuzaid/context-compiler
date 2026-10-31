import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

import { Settings } from '@workspace/settings';
import { MacOSDocumentParser } from '@workspace/source-apple-macos/macos-document-parser';

import OpenSooqConnector from './opensooq-connector.ts';

// This package's folder, which holds its manifest.
const folder = fileURLToPath(new URL('..', import.meta.url));

function connector(): OpenSooqConnector {
  const { contextCompiler } = JSON.parse(
    readFileSync(join(folder, 'package.json'), 'utf8'),
  );
  // OpenSooq reads nothing through EventKit.
  return new OpenSooqConnector(
    {
      grantee: 'Codex',
      documentParser: new MacOSDocumentParser(),
      home: '',
      env: {},
      eventKitHelper: '',
    },
    { name: contextCompiler.name, title: contextCompiler.title, folder },
  );
}

// A trimmed copy of the hidden menu of https://jo.opensooq.com/en on 2026-10-30.
const menu =
  '<div class="hidden" aria-hidden="true" id="megaMenuRaw"><a href="/en/cars">Autos</a><a href="/en/cars/motorcycles">Motorcycles</a><a href="/en/property">Property</a><a href="/en/property/apartments-for-rent">Apartments for Rent</a></div>';

// A trimmed copy of a listing object that a live listing page embedded on 2026-10-26.
function listing(id: string, name: string, price: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Motorcycle',
    name,
    sku: Number(id),
    url: `http://jo.opensooq.com/en/search/${id}`,
    image: {
      '@type': 'ImageObject',
      contentUrl: `https://opensooq-imagesv2.os-cdn.com/previews/700x0/${id}.webp`,
      contentLocation: 'Amman, Jordan',
      datePublished: '25-10-2026',
    },
    offers: {
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
      price,
      priceCurrency: 'JOD',
    },
  };
}

// OpenSooq Jordan as the import sees it: the home page with its menu, two
// categories with one listing each, and no robots.txt. requests records
// every request the import sends, to any host; a request to another host is
// an error.
function openSooq(requests: Request[]) {
  const listings: Record<string, ReturnType<typeof listing>> = {
    '287909010': listing('287909010', 'TARO RANGER 401cc', '1500'),
    '287909020': listing('287909020', 'Apartment in Abdoun', '450'),
  };
  const categories: Record<string, string> = {
    '/en/cars/motorcycles': '287909010',
    '/en/property/apartments-for-rent': '287909020',
  };
  const server = setupServer(
    http.get('https://jo.opensooq.com/*', ({ request }) => {
      const { pathname } = new URL(request.url);
      if (pathname === '/robots.txt')
        return new HttpResponse(null, { status: 404 });
      if (pathname === '/en')
        return HttpResponse.html(
          `<html><body><nav><a href="/en/cars">Autos</a></nav>${menu}</body></html>`,
        );
      const id = categories[pathname];
      if (id !== undefined)
        return HttpResponse.html(
          `<html><body><main><a href="/en/search/${id}">Listing</a></main></body></html>`,
        );
      const object = listings[pathname.replace('/en/search/', '')];
      if (object !== undefined)
        return HttpResponse.html(
          `<html><head><script type="application/ld+json">${JSON.stringify(object)}</script></head><body></body></html>`,
        );
      return new HttpResponse(null, { status: 404 });
    }),
  );
  server.events.on('request:start', ({ request }) => {
    requests.push(request);
  });
  server.listen({ onUnhandledRequest: 'error' });
  return { [Symbol.dispose]: () => server.close() };
}

test('an import with no category chosen fails as the user’s to fix, and requests nothing', async () => {
  await using scratch = await mkdtempDisposable(join(tmpdir(), 'opensooq-'));
  const requests: Request[] = [];
  using _wire = openSooq(requests);
  const opensooq = connector();
  using settings = new Settings(join(scratch.path, 'Imports'));
  const selection = {
    connector: opensooq.name,
    scope: {},
    includeAttachments: false,
  };
  settings.select([selection], {
    facts: () => opensooq,
    permissions: () => opensooq.guidance(),
  });

  const outcome = await opensooq.import(settings, selection);

  assert.equal(outcome.status, 'unconnected');
  const failure = settings.connectionFailure(selection);
  assert.equal(failure?.failureType, 'config');
  assert.match(
    opensooq.failure(
      outcome.status === 'unconnected' ? outcome.error : undefined,
      failure?.failureType,
    ),
    /category/i,
  );
  assert.deepEqual(requests, []);
});

test('setup offers the categories of OpenSooq Jordan, each under its top-level category', async () => {
  using _wire = openSooq([]);

  const [categories] = await connector().listChoices();

  assert.deepEqual(categories?.options, [
    { id: 'https://jo.opensooq.com/en/cars', label: 'Autos' },
    {
      id: 'https://jo.opensooq.com/en/cars/motorcycles',
      label: 'Autos / Motorcycles',
    },
    { id: 'https://jo.opensooq.com/en/property', label: 'Property' },
    {
      id: 'https://jo.opensooq.com/en/property/apartments-for-rent',
      label: 'Property / Apartments for Rent',
    },
  ]);
});

test('an import of the categories chosen in setup loads their listings and the categories, from jo.opensooq.com alone', async () => {
  await using scratch = await mkdtempDisposable(join(tmpdir(), 'opensooq-'));
  const requests: Request[] = [];
  using _wire = openSooq(requests);
  const opensooq = connector();
  const [categories] = await opensooq.listChoices();
  const chosen = (categories?.options ?? [])
    .filter(({ label }) => label.includes(' / '))
    .map(({ id }) => id);
  using settings = new Settings(join(scratch.path, 'Imports'));
  const selection = {
    connector: opensooq.name,
    scope: { collectionIds: chosen },
    includeAttachments: false,
  };
  settings.select([selection], {
    facts: () => opensooq,
    permissions: () => opensooq.guidance(),
  });

  const outcome = await opensooq.import(settings, selection);

  assert.deepEqual(outcome, { status: 'imported' });
  using database = new DatabaseSync(settings.database(selection), {
    readOnly: true,
  });
  assert.deepEqual(
    database
      .prepare('SELECT status FROM sync_attempts')
      .all()
      .map(({ status }) => status),
    ['succeeded'],
  );
  assert.deepEqual(
    database
      .prepare(
        'SELECT inputUrl, title, price, currency FROM opensooq_listings ORDER BY id',
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        inputUrl: 'https://jo.opensooq.com/en/cars/motorcycles',
        title: 'TARO RANGER 401cc',
        price: 1500,
        currency: 'JOD',
      },
      {
        inputUrl: 'https://jo.opensooq.com/en/property/apartments-for-rent',
        title: 'Apartment in Abdoun',
        price: 450,
        currency: 'JOD',
      },
    ],
  );
  assert.equal(
    database.prepare('SELECT count(*) AS count FROM opensooq_categories').get()
      ?.count,
    4,
  );
  assert.deepEqual(
    [...new Set(requests.map((request) => new URL(request.url).host))],
    ['jo.opensooq.com'],
  );
  assert.deepEqual(
    [...new Set(requests.map((request) => request.headers.get('user-agent')))],
    [null],
  );
  // The HTTP cache is the import's own, so it goes with the import.
  assert.ok(existsSync(join(settings.directory(selection), 'web-http.sqlite')));
});
