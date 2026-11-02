import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import pRetry from 'p-retry';

import {
  type Catalog,
  Connection,
  Copy,
  CopyConfiguration,
  type DerivedDataset,
  type DocumentParser,
  DocumentText,
  type FailureType,
  LocalFiles,
  Pipeline,
  type PipelineClock,
  PipelineError,
  type Source,
  type Stream,
  StreamStatus,
  WatchError,
} from '@workspace/elt';
import {
  ComputedDataset,
  SQLiteCheckpointStore,
  SQLiteColumns,
  SQLiteDestination,
  SQLiteSyncHistory,
  type SQLiteTable,
} from '@workspace/elt-sqlite';
import type { GoogleRequester } from '@workspace/google-auth';
import {
  ConnectorRemovedError,
  type Selection,
  type Settings,
} from '@workspace/settings';
import type { ImportScope } from '@workspace/source-apple-macos/import-scope';

import { type Choice, type Row, type Rows, isRow } from './choice.ts';

export type { Selection } from '@workspace/settings';

// What the host running a connector offers it.
export type ConnectorHost = {
  // The home folder of the user whose apps the connectors read: each
  // connector finds its app's stores under it.
  readonly home: string;
  // The environment the EventKit helper runs with, as the host's own
  // process has it: its TZ gives an all-day item its dates.
  readonly env: NodeJS.ProcessEnv;
  readonly documentParser: DocumentParser;
  // The app macOS grants access to: ChatGPT for the plugin, the terminal
  // that launched the CLI.
  readonly grantee: string;
  // The compiled EventKit helper Calendar and Reminders read through: beside
  // the plugin's bundled server, or in @workspace/sdk-apple-eventkit's dist.
  readonly eventKitHelper: string;
  // The clock of every pipeline a connector builds: a host gives globalThis,
  // a test a fake clock that it moves (elt ADR 0019).
  readonly clock: PipelineClock;
  // A Google session for content an app keeps in Google, such as
  // Calendar attachments in Drive and Gmail. Without one, it stays a link.
  google?(scopes: readonly string[]): Promise<GoogleRequester>;
};

// The connector's name and title, as its manifest declares them, and the
// folder the manifest was read from.
export type ConnectorIdentity = {
  readonly name: string;
  readonly title: string;
  readonly folder: string;
};

// A view a reader can load before querying an import: a SQL file that creates
// one temporary view named after the file, so nothing is stored in the import.
export type Preset = {
  readonly name: string;
  readonly file: string;
};

export type ChoiceOptions = Choice & {
  readonly options: readonly { readonly id: string; readonly label: string }[];
};

// How one pass or watch of an import ended, for its host to show.
export type ImportOutcome =
  // The passes ran; the import's sync history records how each stream went.
  | { readonly status: 'imported' }
  // The user removed the connector while its pass ran; its import is now stale.
  | { readonly status: 'removed' }
  // No connection could be built; the settings keep why, for status.
  | { readonly status: 'unconnected'; readonly error: unknown };

// The connector for one Mac app. A subclass declares the app's facts and its
// sources; this class lists what it can be narrowed by, builds its load and
// words its selection and failures the same way for every connector and host.
export abstract class Connector {
  readonly name: string;
  readonly title: string;
  // Where the connector keeps its presets, beside its manifest; it may not
  // exist.
  readonly presetsFolder: string;
  // What a date range selects, or null when this app's records have no date.
  abstract readonly datedBy: string | null;
  // Whether macOS keeps the app's store behind Full Disk Access, which it
  // never asks for.
  abstract readonly fullDiskAccess: boolean;
  // What to know before narrowing this connector, such as how the app's
  // collections nest.
  readonly note?: string;
  // The streams listing the accounts or collections an import can be
  // narrowed to.
  protected abstract readonly choices: readonly Choice[];
  // For a connector with no choices: a stream read only to show the app's store
  // opens.
  protected readonly probe?: string;
  // Streams whose rows belong to no account or collection: a narrowed import
  // cannot attribute them, so it leaves them out.
  protected abstract readonly unscoped: readonly string[];
  // File streams that copy the app's own store rather than attachments; they
  // load metadata only.
  protected abstract readonly storeCopies: readonly string[];
  // Data the import keeps in step with what it loads, such as Mail's
  // mail_content_status view; the pipeline refreshes it after each pass.
  protected derived(
    _destination: SQLiteDestination,
  ): readonly DerivedDataset<SQLiteTable>[] {
    return [];
  }

  // Content availability the app can establish from its imported reader views.
  // This does not turn a successful local copy into a claim about cloud data.
  contentStatus(_database: string): readonly string[] {
    return [];
  }

  // Only the connector knows which upstream errors a fresh pass can recover.
  protected retryImport(_error: unknown): boolean {
    return false;
  }

  protected readonly host: ConnectorHost;

  constructor(host: ConnectorHost, identity: ConnectorIdentity) {
    this.host = host;
    this.name = identity.name;
    this.title = identity.title;
    this.presetsFolder = join(identity.folder, 'presets');
  }

  // Read when asked, so a preset added to a user connector's folder is offered
  // without a restart.
  presets(): Preset[] {
    if (!existsSync(this.presetsFolder)) return [];
    return readdirSync(this.presetsFolder)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .map((file) => ({
        name: file.slice(0, -'.sql'.length),
        file: join(this.presetsFolder, file),
      }));
  }

  // What macOS needs granted to the grantee, besides Full Disk Access.
  protected abstract access(grantee: string): string;

  // The elt sources that read the app, such as the Chromium source every
  // Chromium browser shares and one that reads what only Dia keeps. An import
  // loads all of them into one file, one connection for each.
  protected abstract sources(
    scope: ImportScope,
  ): readonly [Source, ...Source[]];

  // The sources an import loads from, given the import's folder for the files
  // a source keeps of its own, such as an HTTP cache; listing choices reads
  // sources(scope).
  protected importSources(
    { scope }: Selection,
    _directory: string,
  ): readonly [Source, ...Source[]] | Promise<readonly [Source, ...Source[]]> {
    return this.sources(scope);
  }

  // The scope an import uses for what its selection leaves out.
  defaultScope(): ImportScope {
    return {};
  }

  narrowsBy(kind: Choice['scope']): boolean {
    return this.choices.some(({ scope }) => scope === kind);
  }

  guidance(): string {
    const { grantee } = this.host;
    return [
      ...(this.fullDiskAccess
        ? [
            `Turn on ${grantee} in System Settings › Privacy & Security › Full Disk Access, then quit and reopen ${grantee}. macOS does not ask for this access.`,
          ]
        : []),
      this.access(grantee),
    ].join(' ');
  }

  // Whose an error is to fix: the user's when any of this connector's sources
  // says so, since only the source that threw it knows it.
  failureType(error: unknown): FailureType {
    return this.sources(this.defaultScope()).some(
      (source) => source.failureType(error) === 'config',
    )
      ? 'config'
      : 'system';
  }

  // What failed, and, when it is the user's to fix, what macOS access the app
  // needs. A failure the history or settings kept passes the type they
  // stored; null, for a stopped pass, has nothing for the user to fix.
  failure(
    error: unknown,
    failureType: FailureType | null = this.failureType(error),
  ): string {
    const message = error instanceof Error ? error.message : String(error);
    return failureType === 'config'
      ? `${message} — ${this.guidance()}`
      : message;
  }

  // What a selection of this connector covers, in a person's words.
  describe(scope: ImportScope): string {
    const parts = [
      ...this.choices.flatMap(({ scope: ids, title }) => {
        const count = scope[ids]?.length;
        if (count === undefined) return [];
        return [
          `${count} ${count === 1 ? title.replace(/(x)es$|s$/, '$1') : title}`,
        ];
      }),
      ...(scope.startAt ? [`from ${localDay(Date.parse(scope.startAt))}`] : []),
      // endAt is exclusive: the last day covered is the one before it.
      ...(scope.endAt
        ? [`until ${localDay(Date.parse(scope.endAt) - 1)}`]
        : []),
    ];
    return parts.length === 0 ? 'everything' : parts.join(', ');
  }

  // The connector's title and what a selection of it covers, as one phrase.
  titled(scope: ImportScope): string {
    const covers = this.describe(scope);
    return covers === 'everything' ? this.title : `${this.title} (${covers})`;
  }

  // The reader view of a stream: raw_inlineAttachments reads as
  // inline_attachments.
  view(stream: string): string {
    return stream.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  // The rows of the streams this connector can be narrowed by. Opening the
  // app's store is also what makes macOS ask for access, so a denial fails
  // here, before anything is selected. Each stream is read from the source
  // that declares it.
  async choiceRows(): Promise<Rows> {
    const declared = await Promise.all(
      this.sources(this.defaultScope()).map(async (source) => ({
        source,
        catalog: await source.discover(),
      })),
    );
    const streams =
      this.probe === undefined
        ? this.choices.map(({ stream }) => stream)
        : [this.probe];
    const undeclared = streams.filter(
      (stream) =>
        !declared.some(({ catalog }) =>
          catalog.streams.some(({ name }) => name === stream),
        ),
    );
    if (undeclared.length > 0)
      throw new TypeError(
        `No source of the ${this.title} connector declares the stream ${undeclared.join(', ')}`,
      );
    const rows = new Map<string, Row[]>();
    for (const { source, catalog } of declared) {
      const read = streams.filter((stream) =>
        catalog.streams.some(({ name }) => name === stream),
      );
      if (read.length > 0) await this.#readChoices(source, catalog, read, rows);
    }
    return rows;
  }

  async #readChoices(
    source: Source,
    catalog: Catalog,
    streams: readonly string[],
    rows: Map<string, Row[]>,
  ): Promise<void> {
    for await (const message of source.read(
      streams.map(
        (stream) =>
          new CopyConfiguration(catalog.get(stream), {
            syncMode: 'full_refresh',
            destinationSyncMode: 'overwrite',
          }),
      ),
      new Map(),
      { clock: this.host.clock },
    )) {
      if (message instanceof StreamStatus) {
        if (message.status === 'FAILED') throw message.error;
        continue;
      }
      if (!('type' in message) && message.stream !== this.probe) {
        const { data } = message;
        if (!isRow(data))
          throw new TypeError(
            `Stream ${message.stream} emitted a record that is not an object`,
          );
        rows.set(message.stream, [...(rows.get(message.stream) ?? []), data]);
      }
    }
  }

  async listChoices(): Promise<ChoiceOptions[]> {
    const rows = await this.choiceRows();
    return this.choices.map((choice) => ({
      ...choice,
      options: (rows.get(choice.stream) ?? []).map((row) => ({
        id: choice.id(row),
        label: choice.label(row, rows),
      })),
    }));
  }

  // One pass of this connector's import, as every host runs it inside the
  // import's flight: stopped once the user removes the connector or signal
  // aborts, as a flight's lease does once the flight is no longer its
  // leader's, its outcome in the import's sync history, and in the settings
  // any failure that history could not record, a failure to connect among
  // them. The pipeline brings the import's derived data, such as the text of
  // the files it stored, in step before the run ends, also when some copies
  // failed, from what did commit.
  async import(
    settings: Settings,
    selection: Selection,
    signal?: AbortSignal,
  ): Promise<ImportOutcome> {
    return this.#load(
      settings,
      selection,
      signal,
      async (pipeline, removal) => {
        const stopped =
          signal === undefined ? removal : AbortSignal.any([removal, signal]);
        let completed = false;
        await pRetry(
          async () => {
            await pipeline.run({ signal: stopped });
            completed = true;
          },
          {
            retries: 2,
            minTimeout: 250,
            factor: 2,
            signal: stopped,
            shouldRetry: ({ error }) =>
              error instanceof PipelineError &&
              error.errors.some((failure: unknown) =>
                this.retryImport(failure),
              ),
          },
        ).catch((error: unknown) => {
          // A stop after the pass committed still leaves a successful import;
          // it only stops the derived data catching up.
          if (completed && stopped.aborted) return;
          // p-retry normalizes non-Error throws; cancellation must preserve
          // the caller's exact reason, including a string or other value.
          stopped.throwIfAborted();
          throw error;
        });
      },
    );
  }

  // Keeps this connector's import current: a pass at once, then one for each
  // change its source reports, each recorded in the import's sync history.
  // The pipeline refreshes the import's derived data after each pass, in the
  // background, so the import never waits on it.
  // Ends once the user removes the connector, once the source stops
  // reporting changes, or quietly once signal aborts; otherwise it lasts as
  // long as the process.
  async watch(
    settings: Settings,
    selection: Selection,
    signal?: AbortSignal,
  ): Promise<ImportOutcome> {
    return this.#load(
      settings,
      selection,
      signal,
      async (pipeline, removal) => {
        const stopped =
          signal === undefined ? removal : AbortSignal.any([removal, signal]);
        for await (const _pass of pipeline.watch({ signal: stopped })) continue;
        // A watch ends quietly on abort, where a run throws its reason.
        removal.throwIfAborted();
      },
    );
  }

  async #load(
    settings: Settings,
    selection: Selection,
    // The caller's own stop, which the load combines with the removal.
    signal: AbortSignal | undefined,
    load: (
      pipeline: Pipeline<SQLiteTable>,
      removal: AbortSignal,
    ) => Promise<unknown>,
  ): Promise<ImportOutcome> {
    using removal = settings.removal(selection);
    let built;
    try {
      built = await this.connections(settings.directory(selection), selection);
    } catch (error) {
      settings.saveConnectionFailure(
        selection,
        error instanceof Error ? error.message : String(error),
        this.failureType(error),
      );
      return { status: 'unconnected', error };
    }
    settings.clearConnectionFailure(selection);
    const { connections, derived } = built;
    // Every host loads an import only while it owns it, so no other process
    // can: a pass of it still recorded running is one whose process ended.
    const history = new SQLiteSyncHistory({ soleWriter: true });
    try {
      await load(
        new Pipeline({
          connections,
          history,
          derived,
          clock: this.host.clock,
        }),
        removal.signal,
      );
    } catch (error) {
      if (error instanceof ConnectorRemovedError) return { status: 'removed' };
      // A caller that stopped the import, as a flight's lost lease does, made
      // no failure: the history recorded the pass cancelled, and the run that
      // goes on records its own outcome.
      if (signal?.aborted && error === signal.reason) throw error;
      // The history recorded each failure these hold: what each copy did not
      // load, or why the watch stopped.
      if (error instanceof PipelineError || error instanceof WatchError)
        return { status: 'imported' };
      // No history recorded this one, such as the history's own failure to
      // install, so the settings keep it where status reads it.
      settings.saveConnectionFailure(
        selection,
        error instanceof Error ? error.message : String(error),
        this.failureType(error),
      );
      throw error;
    }
    return { status: 'imported' };
  }

  // The streams of the connector's sources, loaded incrementally into
  // raw_<stream> tables of the import directory's data.sqlite and read through
  // documented views, with checkpoints.sqlite and attachment copies in files/
  // beside it: one connection for each source, named by the source's identity.
  // Two sources that declare one stream are two writers of its table, which
  // the destination refuses rather than mixing their rows. Its derived
  // datasets are its own and, when it stores files, attachment_text, the text
  // of each file any of its sources stored.
  async connections(
    directory: string,
    selection: Selection,
  ): Promise<{
    connections: readonly [
      Connection<SQLiteTable>,
      ...Connection<SQLiteTable>[],
    ];
    derived: readonly DerivedDataset<SQLiteTable>[];
  }> {
    const { scope, includeAttachments } = selection;
    const sources = await this.importSources(selection, directory);
    const narrowed = Object.keys(scope).length > 0;
    const withFiles = (stream: Stream) =>
      includeAttachments &&
      stream.supportsFileTransfer === true &&
      !this.storeCopies.includes(stream.name);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const destination = new SQLiteDestination({
      path: join(directory, 'data.sqlite'),
    });
    const files = new LocalFiles({ directory: join(directory, 'files') });
    const checkpoints = new SQLiteCheckpointStore({
      path: join(directory, 'checkpoints.sqlite'),
    });
    const load = async (source: Source) => {
      const { streams } = await source.discover();
      const copies = streams
        .filter(({ name }) => !(narrowed && this.unscoped.includes(name)))
        .map((stream) => ({
          stream,
          target: destination
            .table(
              `raw_${stream.name}`,
              withFiles(stream)
                ? (columns) => [
                    ...SQLiteColumns.fromSchema(stream.jsonSchema),
                    columns
                      .text('attachmentRef')
                      .from(stream.file.store(files)),
                  ]
                : undefined,
            )
            .withReaderView(this.view(stream.name)),
        }));
      const connection = new Connection({
        name: source.identity,
        source,
        destination,
        checkpoints,
        steps: copies.map(
          ({ stream, target }) =>
            new Copy(stream, target, {
              id: `${source.identity}:${stream.name}`,
              syncMode: 'incremental',
              destinationSyncMode: 'append_dedup',
            }),
        ),
      });
      return {
        connection,
        stored: copies
          .filter(({ stream }) => withFiles(stream))
          .map(({ target }) => target),
      };
    };
    const [first, ...others] = sources;
    const [loaded, ...more] = await Promise.all([
      load(first),
      ...others.map(load),
    ]);
    const stored = [loaded, ...more].flatMap(({ stored }) => stored);
    return {
      connections: [
        loaded.connection,
        ...more.map(({ connection }) => connection),
      ],
      derived: [
        ...this.derived(destination),
        ...(stored.length === 0
          ? []
          : [
              new ComputedDataset({
                into: destination,
                name: 'attachment_text',
                description:
                  'One row per file this import stored, with the text its parser extracted, read after each sync. A stored file not read yet has no row, so search results are complete only once the text caught up with the sync. Primary key ref.',
                from: stored,
                compute: new DocumentText({
                  parser: () => this.host.documentParser,
                  files: files.directory,
                  column: 'attachmentRef',
                }),
              }),
            ]),
      ],
    };
  }
}

// The calendar day an instant falls on, on the clock of the Mac the host
// runs on, which is the clock a person picks the days of a selection by.
function localDay(epochMilliseconds: number): string {
  const instant = new Date(epochMilliseconds);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}
