import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MacOSDocumentParser } from '@workspace/source-apple-macos/macos-document-parser';

import CalendarConnector from './calendar-connector.ts';

// This package's folder, which holds its manifest.
const folder = fileURLToPath(new URL('..', import.meta.url));

test('an import that stores no attachments needs no Google session, and one that stores them asks for it', async () => {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), 'calendar-connector-'),
  );
  const { contextCompiler } = JSON.parse(
    readFileSync(join(folder, 'package.json'), 'utf8'),
  );
  // The CLI's host without GOOGLE_OAUTH_CLIENT_ID and
  // GOOGLE_OAUTH_CLIENT_SECRET: asking it for a Google session throws. Setting
  // up an import reads nothing through EventKit.
  const calendar = new CalendarConnector(
    {
      grantee: 'Terminal',
      documentParser: new MacOSDocumentParser(),
      home: '',
      env: {},
      eventKitHelper: '',
      google: () =>
        Promise.reject(
          new Error(
            "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET for Calendar's Drive/Gmail attachments.",
          ),
        ),
    },
    { name: contextCompiler.name, title: contextCompiler.title, folder },
  );

  const { connection } = await calendar.connection(
    join(directory.path, 'links'),
    { connector: 'calendar', scope: {}, includeAttachments: false },
  );

  const { streams } = await connection.source.discover();
  assert.ok(streams.some(({ name }) => name === 'events'));
  await assert.rejects(
    calendar.connection(join(directory.path, 'files'), {
      connector: 'calendar',
      scope: {},
      includeAttachments: true,
    }),
    /GOOGLE_OAUTH_CLIENT_ID/,
  );
});
