import assert from 'node:assert/strict';
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

import { PersistentWriteAheadLog, open } from '@zukhruf/sqlite-open';
import { TemporaryFiles } from '@zukhruf/testing/fs';
import { z } from 'zod';

import { Journal } from './journal/journal.ts';

// Ambient runs as it runs on a Mac, with the real GPT-6-Luna through the
// developer's Codex login. The model decides freely, so these tests assert
// only what Ambient does around a decision: which changes become turns, and
// that each turn ends in a recorded decision or failure.

const imports = (home: string) =>
  join(home, 'Library/Application Support/Context Compiler/Imports');
const state = (home: string) =>
  join(home, 'Library/Application Support/Context Compiler/Ambient');

// The Context Compiler warehouse of a Mac whose home is home: settings.sqlite
// publishes selected_connectors, and the Mail import is a WAL database, as
// elt's destination writes them.
async function warehouse(resources: DisposableStack, home: string) {
  await mkdir(imports(home), { recursive: true });
  const settings = resources.use(
    open(join(imports(home), 'settings.sqlite'), {
      journal: new PersistentWriteAheadLog(),
    }),
  );
  settings.exec(
    "CREATE TABLE selected_connectors(connector TEXT PRIMARY KEY,database TEXT,connection_error TEXT); INSERT INTO selected_connectors VALUES('mail','mail.sqlite',NULL)",
  );
  const mail = resources.use(open(join(imports(home), 'mail.sqlite')));
  mail.exec('CREATE TABLE messages(id INTEGER PRIMARY KEY,body TEXT)');
  return { settings, mail };
}

const available = async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  server.close();
  return address.port;
};

// Runs Ambient's entry point as a plain node process on a Mac whose home is
// home, until it answers /health. Disposal stops it as Ctrl-C does.
async function ambient(t: TestContext, home: string) {
  const port = await available();
  const child: ChildProcess = spawn(
    process.execPath,
    [join(import.meta.dirname, 'server.ts')],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        HOME: home,
        // Microsandbox keeps its runtime, images and microVMs in its own
        // home, which defaults to ~/.microsandbox; this one is the developer's.
        MSB_HOME: process.env.MSB_HOME ?? join(homedir(), '.microsandbox'),
        // The developer's ChatGPT login of Codex, which the model uses.
        CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), '.codex'),
        AMBIENT_PORT: String(port),
      },
    },
  );
  const origin = `http://127.0.0.1:${port}`;
  let output = '';
  const exited = once(child, 'exit');
  // Ambient announces its address once it serves.
  const ready = new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error(`Ambient was not ready in a minute:\n${output}`)),
      60_000,
    );
    const read = (data: Buffer) => {
      output += data;
      if (!output.includes(`Ambient: ${origin}`)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error(`Ambient exited before it was ready:\n${output}`));
    });
  });
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    return response.json();
  };
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGINT');
    await Promise.race([exited, setTimeout(30_000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  };
  try {
    await ready;
    // The announcement comes as the server starts to listen.
    await t.waitFor(
      async () =>
        assert.deepEqual(await get('/health'), {
          status: 'ready',
          model: 'gpt-6-luna',
        }),
      { timeout: 5000, interval: 50 },
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return {
    decisions: async () => z.array(z.unknown()).parse(await get('/decisions')),
    notifications: async () =>
      z
        .array(z.object({ message: z.string(), evidence: z.unknown() }))
        .parse(await get('/notifications')),
    [Symbol.asyncDispose]: stop,
  };
}
type Ambient = Awaited<ReturnType<typeof ambient>>;

// The microVM that Ambient names after its state directory.
const microVm = (home: string) =>
  `ambient-${createHash('sha256').update(state(home)).digest('hex').slice(0, 16)}`;
const run = promisify(execFile);
const msb = (args: string[]) => run('msb', args);
async function removeMicroVm(home: string) {
  try {
    await msb(['rm', '--force', '--quiet', microVm(home)]);
  } catch (error) {
    // A run that failed before its first turn made no microVM.
    const { stdout } = await msb(['ls', '--quiet']);
    if (stdout.split('\n').includes(microVm(home))) throw error;
  }
}

// Each selected source takes its baseline just after Ambient is ready. A
// write before the baseline is part of it and gives no turn, so a test writes
// after two polling intervals.
const baselines = () => setTimeout(2100);

async function settled(t: TestContext, app: Ambient, count: number) {
  await t.waitFor(
    async () => {
      const decisions = await app.decisions();
      assert.equal(decisions.length, count);
      assert.doesNotMatch(
        JSON.stringify(decisions),
        /"decision":null,"failure":null/,
      );
    },
    { timeout: 120_000, interval: 500 },
  );
}

test('dropping a recreated table is a new change, not a retry of the earlier drop', async (t) => {
  await using directory = await new TemporaryFiles().directory(
    'ambient-schema-',
  );
  const home = directory.path;
  using databases = new DisposableStack();
  const { mail } = await warehouse(databases, home);
  try {
    await using app = await ambient(t, home);
    await baselines();
    for (const [index, sql] of [
      "INSERT INTO messages VALUES(1,'First')",
      'DROP TABLE messages',
      "CREATE TABLE messages(id INTEGER PRIMARY KEY,body TEXT); INSERT INTO messages VALUES(1,'First')",
      'DROP TABLE messages',
    ].entries()) {
      mail.exec(sql);
      await settled(t, app, index + 1);
    }
  } finally {
    await removeMicroVm(home);
  }
});

test('committed warehouse writes reach the agent without an event publisher', async (t) => {
  await using directory = await new TemporaryFiles().directory('ambient-feed-');
  const home = directory.path;
  using databases = new DisposableStack();
  const { mail } = await warehouse(databases, home);
  try {
    await using app = await ambient(t, home);
    await baselines();
    mail
      .prepare('INSERT INTO messages VALUES(?,?)')
      .run(1, 'A committed warehouse change');
    await settled(t, app, 1);
    assert.partialDeepStrictEqual(await app.decisions(), [
      {
        event: {
          source: 'mail',
          data: { after: { body: 'A committed warehouse change' } },
        },
      },
    ]);
  } finally {
    await removeMicroVm(home);
  }
});

test('a row from before the first run gives no turn, and updates, recurrence, deletes and offline catch-up preserve native history', async (t) => {
  await using directory = await new TemporaryFiles().directory('ambient-');
  const home = directory.path;
  using databases = new DisposableStack();
  const { mail } = await warehouse(databases, home);
  mail.exec("INSERT INTO messages VALUES(1,'North building')");
  try {
    {
      await using app = await ambient(t, home);
      await baselines();
      assert.deepEqual(await app.decisions(), []);
      for (const [index, body] of [
        'South building',
        'North building',
        'South building',
      ].entries()) {
        mail.prepare('UPDATE messages SET body=? WHERE id=1').run(body);
        await settled(t, app, index + 1);
      }
      mail.exec('DELETE FROM messages WHERE id=1');
      await settled(t, app, 4);
      assert.partialDeepStrictEqual(await app.decisions(), [
        { event: { data: { op: 'delete', key: { id: '1' } } } },
        {
          event: { data: { op: 'update', after: { body: 'South building' } } },
        },
        {
          event: { data: { op: 'update', after: { body: 'North building' } } },
        },
        {
          event: { data: { op: 'update', after: { body: 'South building' } } },
        },
      ]);
    }
    mail.exec(
      "INSERT INTO messages VALUES(2,'Arrived while Ambient was stopped')",
    );
    {
      await using app = await ambient(t, home);
      await settled(t, app, 5);
      // Cross two native polling intervals: acknowledged history is not resampled.
      await setTimeout(2100);
      const decisions = await app.decisions();
      assert.equal(decisions.length, 5);
      assert.partialDeepStrictEqual(decisions[0], {
        event: {
          data: { after: { body: 'Arrived while Ambient was stopped' } },
        },
      });
    }
  } finally {
    await removeMicroVm(home);
  }
});

test('an interrupted handoff survives restart without resampling', async (t) => {
  await using directory = await new TemporaryFiles().directory('ambient-');
  const home = directory.path;
  using databases = new DisposableStack();
  const { mail } = await warehouse(databases, home);
  mail.exec("INSERT INTO messages VALUES(1,'Venue changed')");
  // The state a process leaves when it stops after the durable capture of a
  // change and before its queue receipt and position acknowledgement. The
  // restart's feed takes its baseline of the same row, so only the handoff
  // gives a turn.
  await mkdir(state(home), { recursive: true });
  let captured: string;
  {
    using journal = new Journal(join(state(home), 'observer.sqlite'));
    captured = journal.capture('mail', {
      table: 'messages',
      op: 'insert',
      key: { id: 1n },
      after: { id: 1n, body: 'Venue changed' },
    }).id;
  }
  try {
    {
      await using app = await ambient(t, home);
      await settled(t, app, 1);
      await setTimeout(2100);
      assert.partialDeepStrictEqual(await app.decisions(), [{ id: captured }]);
    }
    {
      await using app = await ambient(t, home);
      await setTimeout(2100);
      assert.partialDeepStrictEqual(await app.decisions(), [{ id: captured }]);
    }
  } finally {
    await removeMicroVm(home);
  }
});

test('a newly selected source triggers the agent in the microVM of the state folder with its changes, not with the rows it had', async (t) => {
  await using directory = await new TemporaryFiles().directory('ambient-');
  const home = directory.path;
  using databases = new DisposableStack();
  const { mail, settings } = await warehouse(databases, home);
  settings.exec('DELETE FROM selected_connectors');
  mail.exec("INSERT INTO messages VALUES(1,'Imported before the selection')");
  try {
    await using app = await ambient(t, home);
    settings.exec(
      "INSERT INTO selected_connectors VALUES('mail','mail.sqlite',NULL)",
    );
    await baselines();
    assert.deepEqual(await app.decisions(), []);
    mail.exec("INSERT INTO messages VALUES(2,'Venue changed')");
    await settled(t, app, 1);
    assert.partialDeepStrictEqual(await app.decisions(), [
      { event: { data: { after: { body: 'Venue changed' } } } },
    ]);
    const { stdout } = await msb(['ls', '--quiet']);
    assert.ok(stdout.split('\n').includes(microVm(home)));
    settings.exec('DELETE FROM selected_connectors');
    await setTimeout(2100);
    mail.exec("INSERT INTO messages VALUES(3,'Not selected')");
    await setTimeout(2100);
    assert.equal((await app.decisions()).length, 1);
  } finally {
    await removeMicroVm(home);
  }
});
