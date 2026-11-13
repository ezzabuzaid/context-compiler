import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { Declaration } from '@zukhruf/sqlite-drift';
import type { Query } from '@zukhruf/sqlite-federation';
import { open } from '@zukhruf/sqlite-open';
import { transaction } from '@zukhruf/sqlite-transaction';
import { z } from 'zod';

import { type Condition, Eca, type Rule } from '@eltjs/eca';

import { ImportsWarehouse } from './imports-warehouse.ts';

// A monitor package's package.json: what the page shows of it, read without
// running its code, and the entry whose default export has evaluate(sql).
const manifestSchema = z.object({
  type: z.literal('module'),
  exports: z.string().startsWith('./'),
  contextCompiler: z.strictObject({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    title: z.string().min(1),
    description: z.string().min(1),
    instruction: z.string().min(1),
  }),
});

// What a condition an agent wrote resolves to, checked at the boundary since
// eca only sees the condition's own claims.
const matchesSchema = z.array(z.object({ key: z.string(), data: z.unknown() }));

type Match = z.infer<typeof matchesSchema>[number];

type MonitorManifest = z.infer<typeof manifestSchema>['contextCompiler'] & {
  readonly folder: string;
};

type Loaded = MonitorManifest & {
  readonly condition: Condition<Query, Match>;
};

// Each registered monitor: the chat its instruction goes to, its eca cursor,
// and its last run and failure as the page shows them. Its messages wait in
// monitor_messages from the evaluation that found them until they are sent,
// a transactional outbox: they are saved with the cursor that moved past
// their matches, so a stop between the two neither loses nor doubles them.
const monitorTables = new Declaration(
  [
    'CREATE TABLE monitors (name TEXT PRIMARY KEY, thread TEXT NOT NULL, added_at TEXT NOT NULL, cursor TEXT NOT NULL, ran_at TEXT, failure TEXT, failed_at TEXT)',
    'CREATE TABLE monitor_messages (id INTEGER PRIMARY KEY, name TEXT NOT NULL REFERENCES monitors (name) ON DELETE CASCADE, text TEXT NOT NULL)',
  ],
  { rows: 'replace' },
);

const now = () => new Date().toISOString();
// macOS caps a command's arguments and environment together at 1 MiB
// (ARG_MAX), and codex queue takes its message only as an argument, so a
// monitor's new keys go in messages of at most 256 KiB.
const messageBytes = 256 * 1024;
const messageOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

type MonitorState =
  | { readonly state: 'inactive' }
  | { readonly state: 'broken'; readonly error: string }
  | {
      readonly state: 'watching';
      readonly thread: string;
      readonly ranAt: string | null;
      readonly failure: string | null;
    };

export type MonitorStatus = {
  readonly name: string;
  readonly title: string;
  readonly description: string | null;
  readonly instruction: string | null;
} & MonitorState;

// A registered monitor that loads, as the eca rule of one check.
type Checked = Rule<Query, Match> & {
  readonly registered: Registered;
  readonly monitor: Loaded;
};

// The monitors in the folder the plugin reads, what each registered one
// last did, and the check that runs after each import: every registered
// monitor's condition over the imports from its cursor, and its new matches
// sent to its chat through `codex queue` as messages: the monitor's
// instruction and their keys.
export class Monitors {
  readonly #root: string;
  readonly #store: string;
  readonly #codex: string;

  constructor(options: {
    readonly root: string;
    readonly store: string;
    readonly codex: string;
  }) {
    this.#root = options.root;
    this.#store = options.store;
    this.#codex = options.codex;
  }

  // Registers a monitor for the chat it was added from, from the imports'
  // newest positions now, so only what starts to match later is sent.
  // imports: the data.sqlite of each selected connector, by its name.
  async add(
    name: string,
    thread: string,
    imports: ReadonlyMap<string, string>,
  ): Promise<void> {
    const { loaded, broken } = await this.#load();
    if (!loaded.has(name)) {
      // A monitor whose file failed to load is named in broken, with why.
      const failure = broken.get(name);
      throw new Error(
        failure === undefined
          ? `No monitor is named ${name}. Write it in ${this.#root} first.`
          : failure,
      );
    }
    const cursor = await new Eca<Query, Match>({
      warehouse: new ImportsWarehouse(imports),
      clock: globalThis,
    }).start();
    using store = this.#open();
    transaction(
      store,
      () => {
        store.prepare('DELETE FROM monitor_messages WHERE name = ?').run(name);
        store
          .prepare(
            'INSERT INTO monitors (name, thread, added_at, cursor) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET thread = excluded.thread, added_at = excluded.added_at, cursor = excluded.cursor, ran_at = NULL, failure = NULL, failed_at = NULL',
          )
          .run(name, thread, now(), cursor);
      },
      { mode: 'immediate' },
    );
  }

  // Evaluates every registered monitor that loads from its cursor, saves the
  // messages of its new matches with its new cursor, and then sends each
  // monitor's waiting messages to its chat in turn, deleting each once it
  // went. A send that fails, as to a deleted chat, fails only its monitor,
  // whose messages go at the next check. A cursor the imports can no longer
  // read, as after an import made again, starts again from now, and the
  // monitor says so. What a check writes goes to the registration it read,
  // so a monitor removed or added again meanwhile keeps what that change
  // wrote.
  async check(imports: () => ReadonlyMap<string, string>): Promise<void> {
    const { loaded } = await this.#load();
    using store = this.#open();
    const rules: { rule: Checked; cursor: string }[] = [];
    for (const registered of registeredMonitors(store)) {
      const monitor = loaded.get(registered.name);
      if (monitor !== undefined)
        rules.push({
          rule: { condition: monitor.condition, registered, monitor },
          cursor: registered.cursor,
        });
    }
    if (rules.length === 0) return;
    const failed = new Set<string>();
    let eca: Eca<Query, Match>;
    try {
      eca = new Eca({
        warehouse: new ImportsWarehouse(imports()),
        clock: globalThis,
      });
    } catch (error) {
      // No import can be found, as with settings that cannot be read: each
      // monitor says why, and the next import checks it again.
      for (const { rule } of rules)
        fail(store, rule.registered, `Last check failed: ${messageOf(error)}`);
      return;
    }
    for await (const outcome of eca.evaluate(rules)) {
      const { registered, monitor } = outcome.rule;
      if ('expired' in outcome) {
        failed.add(registered.name);
        save(store, registered, {
          cursor: await eca.start(),
          messages: [],
          failure: `Started again from now: ${outcome.expired}. What changed since its last check was not checked.`,
        });
        continue;
      }
      const failure =
        'error' in outcome
          ? `Last check failed: ${messageOf(outcome.error)}`
          : null;
      if (failure !== null) failed.add(registered.name);
      save(store, registered, {
        cursor: outcome.cursor,
        messages: messages(
          monitor,
          outcome.matches.map(({ key }) => key),
        ),
        failure,
      });
    }
    for (const { rule } of rules) {
      const { registered } = rule;
      try {
        await this.#deliver(store, registered);
      } catch (error) {
        failed.add(registered.name);
        fail(
          store,
          registered,
          `Could not send to its chat: ${reasonOf(error)}`,
        );
        continue;
      }
      if (!failed.has(registered.name))
        store
          .prepare(
            'UPDATE monitors SET failure = NULL, failed_at = NULL WHERE name = ? AND added_at = ?',
          )
          .run(registered.name, registered.addedAt);
    }
  }

  // Sends a monitor's waiting messages in the order they were saved, each
  // deleted once it went, so a send that fails leaves it and those after it.
  async #deliver(store: DatabaseSync, registered: Registered): Promise<void> {
    const waiting = store
      .prepare(
        'SELECT id, text FROM monitor_messages WHERE name = ? ORDER BY id',
      )
      .all(registered.name);
    for (const { id, text } of waiting) {
      await promisify(execFile)(this.#codex, [
        'queue',
        '--thread',
        registered.thread,
        '--message',
        String(text),
      ]);
      store
        .prepare('DELETE FROM monitor_messages WHERE id = ?')
        .run(Number(id));
      store
        .prepare(
          'UPDATE monitors SET ran_at = ? WHERE name = ? AND added_at = ?',
        )
        .run(now(), registered.name, registered.addedAt);
    }
  }

  // Every monitor found or registered: one that loads and is registered
  // watches; one that loads and is not waits to be added from a chat.
  async status(): Promise<MonitorStatus[]> {
    const { loaded, broken } = await this.#load();
    using store = this.#open();
    const registered = new Map(
      registeredMonitors(store).map((item) => [item.name, item]),
    );
    const names = [
      ...new Set([...loaded.keys(), ...broken.keys(), ...registered.keys()]),
    ].sort();
    return names.map((name): MonitorStatus => {
      const monitor = loaded.get(name);
      const shown = {
        name,
        title: monitor?.title ?? name,
        description: monitor?.description ?? null,
        instruction: monitor?.instruction ?? null,
      };
      const error = broken.get(name);
      if (error !== undefined) return { ...shown, state: 'broken', error };
      if (monitor === undefined)
        return { ...shown, state: 'broken', error: 'Its folder is gone.' };
      const added = registered.get(name);
      if (added === undefined) return { ...shown, state: 'inactive' };
      return {
        ...shown,
        state: 'watching',
        thread: added.thread,
        ranAt: added.ranAt,
        failure: added.failure,
      };
    });
  }

  // Forgets a monitor and deletes its folder.
  async remove(name: string): Promise<void> {
    const { loaded } = await this.#load();
    {
      using store = this.#open();
      store.prepare('DELETE FROM monitors WHERE name = ?').run(name);
    }
    const folder = loaded.get(name)?.folder;
    if (folder !== undefined) rmSync(folder, { recursive: true, force: true });
  }

  #open(): DatabaseSync {
    mkdirSync(dirname(this.#store), { recursive: true });
    const store = open(this.#store, { timeout: 30_000 });
    try {
      monitorTables.apply(store);
      return store;
    } catch (error) {
      store.close();
      throw error;
    }
  }

  // Each folder's monitor, or why it did not load. Node keeps a module it
  // loaded, so the entry's URL carries its modification time: an edited
  // monitor loads again.
  async #load(): Promise<{
    loaded: Map<string, Loaded>;
    broken: Map<string, string>;
  }> {
    const loaded = new Map<string, Loaded>();
    const broken = new Map<string, string>();
    if (existsSync(this.#root))
      for (const folder of readdirSync(this.#root).sort()) {
        const path = join(this.#root, folder);
        const manifestPath = join(path, 'package.json');
        if (!existsSync(manifestPath)) continue;
        let parsed: z.infer<typeof manifestSchema>;
        try {
          parsed = manifestSchema.parse(
            JSON.parse(readFileSync(manifestPath, 'utf8')),
          );
        } catch (error) {
          broken.set(folder, `Could not be loaded: ${messageOf(error)}`);
          continue;
        }
        const manifest = { ...parsed.contextCompiler, folder: path };
        try {
          const entry = pathToFileURL(join(path, parsed.exports));
          entry.searchParams.set('modified', String(statSync(entry).mtimeMs));
          const { default: exported }: { default?: unknown } = await import(
            entry.href
          );
          loaded.set(manifest.name, {
            ...manifest,
            condition: conditionOf(exported),
          });
        } catch (error) {
          broken.set(manifest.name, `Could not be loaded: ${messageOf(error)}`);
        }
      }
    return { loaded, broken };
  }
}

type Registered = {
  readonly name: string;
  readonly thread: string;
  readonly addedAt: string;
  readonly cursor: string;
  readonly ranAt: string | null;
  readonly failure: string | null;
};

function registeredMonitors(store: DatabaseSync): Registered[] {
  return store
    .prepare(
      'SELECT name, thread, added_at, cursor, ran_at, failure FROM monitors ORDER BY name',
    )
    .all()
    .map((row) => ({
      name: String(row.name),
      thread: String(row.thread),
      addedAt: String(row.added_at),
      cursor: String(row.cursor),
      ranAt: row.ran_at === null ? null : String(row.ran_at),
      failure: row.failure === null ? null : String(row.failure),
    }));
}

// Saves one evaluation of a monitor in one transaction: the messages of its
// new matches, the cursor past them, and its failure, if the registration it
// read is still there: not removed, and not added again since.
function save(
  store: DatabaseSync,
  registered: Registered,
  evaluated: {
    readonly cursor: string;
    readonly messages: readonly string[];
    readonly failure: string | null;
  },
) {
  transaction(
    store,
    () => {
      const { changes } = store
        .prepare(
          'UPDATE monitors SET cursor = ? WHERE name = ? AND added_at = ?',
        )
        .run(evaluated.cursor, registered.name, registered.addedAt);
      if (changes === 0) return;
      const insert = store.prepare(
        'INSERT INTO monitor_messages (name, text) VALUES (?, ?)',
      );
      for (const text of evaluated.messages) insert.run(registered.name, text);
      if (evaluated.failure !== null)
        fail(store, registered, evaluated.failure);
    },
    { mode: 'immediate' },
  );
}

function fail(store: DatabaseSync, registered: Registered, failure: string) {
  store
    .prepare(
      'UPDATE monitors SET failure = ?, failed_at = ? WHERE name = ? AND added_at = ?',
    )
    .run(failure, now(), registered.name, registered.addedAt);
}

// A monitor's new keys as the messages its chat reads in turn, each naming
// the monitor and as many keys as fit in messageBytes.
function messages(monitor: Loaded, keys: readonly string[]): string[] {
  const head = `Monitor "${monitor.title}" triggered: ${monitor.instruction}\nNew matches:`;
  const batches: string[][] = [];
  let batch: string[] = [];
  let size = Buffer.byteLength(head);
  for (const key of keys) {
    const line = Buffer.byteLength(`\n- ${key}`);
    if (batch.length > 0 && size + line > messageBytes) {
      batches.push(batch);
      batch = [];
      size = Buffer.byteLength(head);
    }
    batch.push(key);
    size += line;
  }
  if (batch.length > 0) batches.push(batch);
  return batches.map((keys) =>
    [head, ...keys.map((key) => `- ${key}`)].join('\n'),
  );
}

// What codex said when it refused, rather than the command line Node puts
// before it.
function reasonOf(error: unknown): string {
  const said =
    typeof error === 'object' && error !== null && 'stderr' in error
      ? String(error.stderr).trim()
      : '';
  return said === '' ? messageOf(error) : said;
}

// A monitor module's default export: an object with evaluate(sql) that gives
// the keys true in the imports a handle reads, checked at the boundary. As an
// eca condition, a step's matches are the keys true after and not before.
function conditionOf(exported: unknown): Condition<Query, Match> {
  const evaluate: unknown =
    typeof exported === 'object' && exported !== null && 'evaluate' in exported
      ? exported.evaluate
      : undefined;
  if (typeof evaluate !== 'function')
    throw new TypeError(
      'Its entry does not export an object with evaluate(sql) by default.',
    );
  const matching = async (sql: Query) =>
    new Map(
      matchesSchema
        .parse(await Reflect.apply(evaluate, exported, [sql]))
        .map((match) => [match.key, match]),
    );
  return {
    async evaluate(before, after) {
      const was = await matching(before.sql);
      return [...(await matching(after.sql)).values()].filter(
        ({ key }) => !was.has(key),
      );
    },
  };
}
