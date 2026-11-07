import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  PollingChangeSource,
  SqliteContextStore,
  SqliteStreamStore,
  StreamManager,
} from '@deepagents/context';
import {
  PgBossTurnQueue,
  SqliteMailboxStore,
  defineStack,
} from '@deepagents/experimental/zukhruf';
import { PGlite } from '@electric-sql/pglite';
import { open } from '@zukhruf/sqlite-open';
import { PgBoss, fromPglite } from 'pg-boss';

import { Journal } from './journal/journal.ts';
import services from './plugins/changes/services.ts';
import { Warehouse } from './warehouse/warehouse.ts';

// The private runtime state of Ambient, beside the Context Compiler imports
// it reads. sandbox.ts names the microVM after it.
export const state = join(
  homedir(),
  'Library/Application Support/Context Compiler/Ambient',
);
const imports = join(
  homedir(),
  'Library/Application Support/Context Compiler/Imports',
);

export default defineStack(async (resources) => {
  await mkdir(state, { recursive: true, mode: 0o700 });
  const database = resources.use(new PGlite(join(state, 'queue')));
  const boss = resources.adopt(
    new PgBoss({ db: fromPglite(database), backend: 'pglite' }),
    (boss) => boss.stop({ graceful: false }),
  );
  boss.on('error', (error) => console.error('[ambient queue]', error));
  await boss.start();
  const streamStore = new SqliteStreamStore(
    resources.use(open(join(state, 'streams.sqlite'))),
  );
  return {
    store: new SqliteContextStore(
      resources.use(open(join(state, 'context.sqlite'))),
    ),
    streams: new StreamManager({
      store: streamStore,
      changeSource: new PollingChangeSource({ reads: streamStore }),
    }),
    queue: await PgBossTurnQueue.create(boss, {
      pollingIntervalSeconds: 0.5,
      schema: 'pgboss',
    }),
    mailboxStore: resources.use(
      new SqliteMailboxStore(join(state, 'mailbox.sqlite')),
    ),
    bindings: [
      services.bind({
        journal: resources.use(new Journal(join(state, 'observer.sqlite'))),
        warehouse: new Warehouse(imports),
        streams: streamStore,
        positions: join(state, 'positions'),
      }),
    ],
  };
});
