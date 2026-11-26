import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MacOSDocumentParser } from '@eltjs/source-apple-macos/macos-document-parser';

import { builtInConnectors } from './built-in-connectors.ts';
import { Connectors } from './connectors.ts';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

test('every connector folder loads as its connector for the host, and one that cannot load is reported by its title while the rest still load', async () => {
  const { connectors, broken } = await new Connectors([
    builtInConnectors,
    fixtures,
    fileURLToPath(new URL('./missing/', import.meta.url)),
  ]).load({
    clock: globalThis,
    home: homedir(),
    env: process.env,
    documentParser: new MacOSDocumentParser(),
    eventKitHelper: fileURLToPath(
      import.meta.resolve('@eltjs/sdk-apple-eventkit/eventkit-helper'),
    ),
  });

  assert.deepEqual(connectors.map(({ name }) => name).sort(), [
    'accounts',
    'activity',
    'arc',
    'books',
    'calendar',
    'call-history',
    'chrome',
    'clock',
    'contacts',
    'dia',
    'edge',
    'instagram',
    'mail',
    'messages',
    'notes',
    'notification-center',
    'opensooq',
    'photos',
    'reminders',
    'safari',
    'slack',
    'teams',
    'wallet',
    'whatsapp',
  ]);
  assert.equal(
    connectors.find(({ name }) => name === 'notification-center')?.title,
    'Notification Center',
  );
  assert.equal(connectors.find(({ name }) => name === 'slack')?.title, 'Slack');
  assert.equal(connectors.find(({ name }) => name === 'dia')?.title, 'Dia');
  assert.equal(
    connectors.find(({ name }) => name === 'teams')?.title,
    'Microsoft Teams',
  );
  assert.equal(
    connectors.find(({ name }) => name === 'instagram')?.title,
    'Instagram',
  );
  assert.equal(
    connectors.find(({ name }) => name === 'wallet')?.title,
    'Wallet',
  );
  assert.equal(
    connectors.find(({ name }) => name === 'whatsapp')?.title,
    'WhatsApp',
  );
  assert.deepEqual(
    broken.sort((a, b) => a.title.localeCompare(b.title)),
    [
      {
        title: 'Broken',
        error: 'The broken fixture fails while loading.',
      },
      {
        title: 'Not a connector',
        error: `${fixtures}not-a-connector/not-a-connector-connector.ts does not export a Connector class by default.`,
      },
      { title: 'Notes again', error: 'Another connector is named notes.' },
    ],
  );
});
