---
name: add-connector
description: Adds a connector for a Mac app the Context Compiler plugin does not import yet, such as Photos, Music, Podcasts or Stickies, by writing it into the user's connectors folder. Use when the user asks to connect or import a Mac app the plugin does not list, or to fix a connector the Context Compiler status reports as not loading.
---

# Add a connector

## What you need to know

- A connector is a folder in `~/Library/Application Support/Context Compiler/Connectors/<name>/` holding two files: a `package.json` and the entry point it names. The plugin reads that folder on every tool call, so a connector you add or edit is used in this chat; nothing restarts.
- `package.json` is `{ "type": "module", "exports": "./<name>-connector.ts", "contextCompiler": { "name": "<name>", "title": "<Title>" } }`. `name` is lowercase letters, digits and dashes, and must not repeat a connector the plugin already has. `title` is what the user sees. The connector class takes both from here; it does not declare them.
- The entry is TypeScript that Node runs as written, without a compiler. Its default export is a class that extends `Connector`. Its `sources()` returns a list of one or more elt `Source`s that read the app's own data on this Mac. Most apps need one source. Give a second source only for a second store of the app, and give each source its own stream names: two sources that declare one stream fail the import.
- The entry may import only Node built-ins (`node:fs`, `node:sqlite`, `node:child_process`, ...) and four modules the plugin provides: `@workspace/elt` (`Source`, `Stream`, `Catalog`, `Gauge` and their types), `@workspace/connector/connector` (`Connector`) `@workspace/connector/choice` (`accounts`, `collections`, `byId`, `name`, `Choice`) and `@zukhruf/sqlite-open` (`open`, `UnavailableError`). There is no `node_modules`, so no npm package resolves.
- The plugin imports each stream into `raw_<stream>` in the connector's own `data.sqlite`, read through a view named after the stream in snake case (`photoAssets` reads as `photo_assets`). `$query` reads it like any other connector.
- The connector runs inside the plugin, with every macOS permission ChatGPT has, Full Disk Access included.
- A connector that cannot load is listed in the Context Compiler status of every chat as `- <Title> could not be loaded: <error>`.
- A connector may also hold presets: SQL files in a `presets` folder beside `package.json`. Each `presets/<view>.sql` holds one `CREATE TEMP VIEW <view> AS …` over the connector's views, after comment lines `-- <view>: <what one row is>` and `-- <column>: <its meaning>` for every column, in order. A reader loads a preset for one query, so it changes nothing in the import, and the Context Compiler status lists it as soon as the file exists.

## Writing the connector

1. Find where the app keeps its data and how to read it read-only: a SQLite store (open it with `open(path, { readOnly: true })` from `@zukhruf/sqlite-open`, and list `UnavailableError` in the source's `configErrors`: a store that macOS denies then reports as a failure that the user can fix, with the connector's guidance, and a store that another process writes waits 5 seconds before it reports busy), property lists (`plutil -convert json -o - <file>`), or the app's scripting (`osascript`). Inspect real rows before writing a schema.
2. Write `package.json` and `<name>-connector.ts` from this template. Keep the connector in that one file.

   ```ts
   import { statSync } from 'node:fs';
   import { homedir } from 'node:os';
   import { join } from 'node:path';

   import { UnavailableError, open } from '@zukhruf/sqlite-open';

   import type { Choice } from '@workspace/connector/choice';
   import { Connector } from '@workspace/connector/connector';
   import {
     Catalog,
     type ChangeSignal,
     type ExtractionCoverage,
     Gauge,
     Source,
     Stream,
   } from '@workspace/elt';

   const store = join(homedir(), 'Library/<where the app keeps its store>');

   // When the app last wrote its store. A SQLite store in WAL mode commits to
   // its -wal file, which is not there while no connection has the store open.
   class StoreStamp extends Gauge<string> {
     protected async read(): Promise<string> {
       return [store, `${store}-wal`]
         .map((file) => statSync(file, { throwIfNoEntry: false })?.mtimeMs)
         .join(':');
     }
   }

   const items = new Stream({
     name: 'items',
     jsonSchema: {
       type: 'object',
       description: 'One item in the app.',
       properties: {
         id: { type: 'string', description: 'The item identifier.' },
         title: { type: ['string', 'null'], description: 'The item title.' },
       },
     },
     primaryKey: ['id'],
     sourceDefinedCursor: true,
     supportedSyncModes: ['full_refresh', 'incremental'],
   });

   class ItemsSource extends Source {
     readonly identity = 'example';
     protected readonly catalog = new Catalog([items]);
     protected override readonly configErrors = [UnavailableError];

     coverage(): ExtractionCoverage {
       return { description: 'every item in the app', selection: {} };
     }

     async currentAsOf() {
       return null;
     }

     protected async open() {
       return new AsyncDisposableStack();
     }

     // Every stream changes with the store, so one gauge tells about all of
     // them. A watch reads it each interval and loads the streams it names
     // once its value changes.
     changeSignals(streams: readonly Stream[]): ChangeSignal[] {
       return [
         { gauge: new StoreStamp(), streams, interval: 1000, timeout: 1000 },
       ];
     }

     protected async *extract() {
       using database = open(store, { readOnly: true });
       for (const row of database.prepare('SELECT id, title FROM items').all())
         yield {
           stream: 'items',
           data: { id: String(row.id), title: row.title },
         };
       yield { type: 'STATE' as const, stream: 'items', state: {} };
     }
   }

   export default class ExampleConnector extends Connector {
     // What a date range selects, such as 'date added', or null.
     readonly datedBy = null;
     // true only when macOS keeps the store behind Full Disk Access, as for
     // ~/Library/Containers, Group Containers, Mail, Messages and Safari.
     readonly fullDiskAccess = false;
     protected readonly choices: readonly Choice[] = [];
     // With nothing to choose, the stream options reads to show the
     // store opens.
     protected override readonly probe = 'items';
     protected readonly unscoped = [];
     protected readonly storeCopies = [];

     // What the user does besides Full Disk Access, or ''.
     protected access(): string {
       return 'Open Example once so it creates its library.';
     }

     protected sources() {
       return [new ItemsSource()];
     }
   }
   ```

3. Let the user narrow the import only when the store can say which account, collection or date a record belongs to. Then list those streams in `choices` (built with `accounts` and `collections`), set `datedBy`, pass the `scope` that `sources(scope)` receives into each source, and filter by its `accountIds`, `collectionIds`, `startAt` (inclusive) and `endAt` (exclusive). List streams whose rows belong to no account or collection in `unscoped`. When there are choices, remove `probe`: reading them shows the store opens.
4. When answering a question about the app needs the same joins each time, write them once as a preset, the shape of the app's data rather than one question's answer.

## Setting it up

1. Call `options` with `connector` set to the connector's `name`. It loads the connector and opens the app's store. Read any `could not be loaded` line in the Context Compiler status or the tool's error, fix the file, and call it again.
2. Configure it with `configure`, keeping every connector already selected, as `$setup` describes. The import runs in the background.
3. Read a few rows as `$query` describes, through each preset too, and compare them with what the app shows.

## Gotchas

- When the entry uses an `enum`, a `namespace` or a constructor parameter property such as `constructor(private store: string)`, Node cannot run it as written and the connector does not load. Declare fields and assign them in the constructor.
- When a stream or one of its fields has no `description`, the import fails with `Reader view <stream> needs JSON Schema descriptions`. Describe every stream and every property.
- When `changeSignals` leaves out a stream, or names one the user did not select, the connector stops watching and its status says `No change signal tells about stream <name>` or `A change signal names an unselected stream: <name>`. Give the signals the `streams` it receives.
- When a record's fields do not match its stream's JSON Schema, such as a `null` where the schema says `string`, the pass fails. Allow `null` (`type: ['string', 'null']`) for any column that can be empty.
- When a connector imports a second file of its own, an edit to that file loads only in a new chat. Keep the connector in its entry.
- When the code writes to the app's store or runs a command that changes the app, it changes the user's data with ChatGPT's permissions. Open stores read-only and only read.
- When `name` repeats a connector the plugin has, the connector is reported as not loading. Pick a new lowercase name.

## Done when

- `options` with the connector's name succeeds, and the Context Compiler status lists no `could not be loaded` line for it.
- The connector is configured, its import has synced, and rows read through `$query` match the app.
- You told the user the connector's folder, what it imports and that it runs with ChatGPT's permissions on their Mac.
