import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { TemporaryFiles } from '@zukhruf/testing/fs';

import { MacOSDocumentParser } from '@eltjs/source-apple-macos/macos-document-parser';

import CalendarConnector from './calendar-connector.ts';

// This package's folder, which holds its manifest.
const folder = fileURLToPath(new URL('..', import.meta.url));

test('an import that stores no attachments needs no Google session, and one that stores them asks for it', async () => {
  await using directory = await new TemporaryFiles().directory(
    'calendar-connector-',
  );
  const { contextCompiler } = JSON.parse(
    readFileSync(join(folder, 'package.json'), 'utf8'),
  );
  // The CLI's host with no Google client file: asking it for a Google session
  // throws. Setting up an import reads nothing through EventKit.
  const calendar = new CalendarConnector(
    {
      clock: globalThis,
      grantee: 'Terminal',
      documentParser: new MacOSDocumentParser(),
      home: '',
      env: {},
      eventKitHelper: '',
      google: () =>
        Promise.reject(
          new Error(
            "Calendar's Drive and Gmail attachments need your Google OAuth client in /Users/me/.config/context-compiler/client_secret.json.",
          ),
        ),
    },
    { name: contextCompiler.name, title: contextCompiler.title, folder },
  );

  const {
    connections: [connection],
  } = await calendar.connections(join(directory.path, 'links'), {
    connector: 'calendar',
    scope: {},
    includeAttachments: false,
  });

  const { streams } = await connection.source.discover();
  assert.ok(streams.some(({ name }) => name === 'events'));
  await assert.rejects(
    calendar.connections(join(directory.path, 'files'), {
      connector: 'calendar',
      scope: {},
      includeAttachments: true,
    }),
    /client_secret\.json/,
  );
});
