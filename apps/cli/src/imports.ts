import { existsSync, rmSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { SqliteElection } from '@zukhruf/election';
import {
  FlightFailedError,
  FlightInterruptedError,
  SingleFlight,
} from '@zukhruf/single-flight';
import type { Locate } from '@zukhruf/sqlite-federation';

import { type PassState, readPassStatus } from '@eltjs/elt-sqlite';
import { userConnectors } from '@workspace/connector-manifest/user-connectors';
import type { ChoiceOptions, Connector } from '@workspace/connector/connector';
import { type Selection, Settings } from '@workspace/settings';

import type { BackgroundWatch } from './background-watch.ts';
import type { Parsing } from './parsing.ts';
import {
  type PassReport,
  type PassSummary,
  type SyncLine,
  SyncPasses,
  WatchPasses,
  failed,
} from './sync.ts';

// Shows a sync from its start to its finish or interruption, each pass in
// between, each import whose pass another sync runs, which this one waits for,
// and each import it did not finish: removed, another setup removed its
// connector while it ran; interrupted, the sync it waited for stopped first;
// watched, a sync watch keeps it current.
export type SyncObserver = PassReport & {
  start(): void;
  joined(connector: Connector): void;
  skipped(
    connector: Connector,
    why: 'removed' | 'interrupted' | 'watched',
  ): void;
  finish(): void;
  interrupted(): void;
};

// Shows a watch as a sync, and also each import it waits to own while another
// process does, each import whose watch stopped on its own, and each time it
// has nothing to watch until a setup selects a connector.
export type WatchObserver = SyncObserver & {
  waiting(connector: Connector): void;
  stopped(connector: Connector): void;
  unselected(): void;
};

// How soon a watch hears that a setup selected a connector.
const followMs = 1_000;

// One selected connector's import, as a sync or a watch runs it, and where it
// shows each line.
type ImportRun = {
  readonly settings: Settings;
  readonly flights: SingleFlight<readonly SyncLine[]>;
  readonly connector: Connector;
  readonly selection: Selection;
  show(line: SyncLine): void;
};

export type { Selection };

export type ConnectorStatus = {
  readonly connector: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly selection: string | null;
  readonly database: string | null;
  // null: disabled. never: enabled, not synced yet.
  readonly state: 'never' | PassState | null;
  readonly completedAt: string | null;
  readonly lastSuccessAt: string | null;
  // When what it loaded last matched the app's store, as a watch keeps it,
  // no later than when the app last wrote a store it writes only at times.
  readonly currentAsOf: string | null;
  readonly error: string | null;
  readonly streams: readonly {
    readonly stream: string;
    readonly state: PassState;
    readonly lastSuccessAt: string | null;
    readonly currentAsOf: string | null;
  }[];
};

// The CLI's imports in the chosen directory: the mediator every command goes
// through. It knows the connectors and keeps their selection in
// settings.sqlite and each selection's import in its own folder: data.sqlite,
// checkpoints and attachment files. Everything here can be rebuilt by syncing
// again.
export class Imports {
  readonly root: string;
  readonly connectors: readonly Connector[];
  readonly #parsing: Parsing;
  readonly #background: BackgroundWatch;

  constructor(
    connectors: readonly Connector[],
    directory: string,
    parsing: Parsing,
    background: BackgroundWatch,
  ) {
    this.connectors = connectors;
    this.root = resolve(directory);
    this.#parsing = parsing;
    this.#background = background;
  }

  get names(): string[] {
    return this.connectors.map(({ name }) => name);
  }

  connector(name: string): Connector {
    const connector = this.#loaded(name);
    if (connector === undefined) throw new Error(`Unknown connector ${name}`);
    return connector;
  }

  #loaded(name: string): Connector | undefined {
    return this.connectors.find((candidate) => candidate.name === name);
  }

  // What a connector can be narrowed to; opening it is also what makes macOS
  // ask for access.
  async options(name: string): Promise<ChoiceOptions[]> {
    return this.connector(name).listChoices();
  }

  selections(): Selection[] {
    using settings = new Settings(this.root);
    return settings.selections();
  }

  // Replaces the selection. A connector that left it, or whose scope changed,
  // loses its import, so the next sync reads it again from the start; a sync
  // importing it now stops, and the next setup or sync removes that import.
  async select(selections: readonly Selection[]): Promise<void> {
    using settings = new Settings(this.root);
    settings.select(selections, {
      facts: (name) => this.connector(name),
    });
    await using flights = this.#flights();
    await removeStale(settings, flights);
  }

  // Where every setup and sync of these imports meets the others: a pass of
  // an import runs in one of them at a time, and the rest wait for its lines.
  #flights(): SingleFlight<readonly SyncLine[]> {
    return new SingleFlight({
      directory: this.root,
      codec: { encode: JSON.stringify, decode: JSON.parse },
      clock: globalThis,
    });
  }

  // Locates known imports; unknown names have no path.
  readonly locate: Locate = (name) => {
    const connector = this.#loaded(name);
    if (connector === undefined) return undefined;
    using settings = new Settings(this.root);
    const selection = settings
      .selections()
      .find(({ connector }) => connector === name);
    if (selection === undefined)
      throw new Error(`${connector.title} is not set up; run: setup`);
    const path = settings.database(selection);
    if (!existsSync(path))
      throw new Error(`${connector.title} has not synced yet; run: sync`);
    return path;
  };

  // One pass of each selected connector, or only of those named, shown through
  // the observer, once the imports no longer selected are removed. A sync that
  // finds another sync running an import's pass waits for that pass and shows
  // it instead of running its own; one that finds a sync watch keeping an
  // import current leaves it to the watch. Ctrl-C or SIGTERM stops a sync at
  // once: what it committed stays and its checkpoints resume it. A pass that
  // did not load completely, or one it waited for whose sync stopped first,
  // leaves exit status 1; a connector another setup removed meanwhile does
  // not. An error no pass recorded, as when an import's sync history cannot
  // install itself, fails only its connector: the others finish and show
  // their passes, then the sync names it and exits 1.
  async sync(
    only: readonly string[] | undefined,
    observer: SyncObserver,
  ): Promise<void> {
    const errors: unknown[] = [];
    await this.#each(only, observer, async (run) => {
      const { settings, flights, connector, selection, show } = run;
      const directory = settings.directory(selection);
      // What this sync shows of its own pass, for the syncs that wait on it.
      const lines: SyncLine[] = [];
      const own = (line: SyncLine) => {
        lines.push(line);
        show(line);
      };
      try {
        const { value, joined } = await flights.run(
          directory,
          async ({ signal }) => {
            await using owner = await owners(settings, directory).campaign();
            if (owner === undefined) {
              own({ connector: connector.name, status: 'watched' });
              return lines;
            }
            using observed = new SyncPasses(connector, {
              progress: (...args) => observer.progress(...args),
              passed: (_, summary) => own(summary),
            });
            const outcome = await observed.run(() =>
              connector.import(settings, selection, signal),
            );
            if (outcome.status === 'unconnected')
              own(failed(connector, outcome.error, 0));
            else if (outcome.status === 'removed')
              own({ connector: connector.name, status: 'removed' });
            return lines;
          },
          { onJoin: () => observer.joined(connector) },
        );
        if (joined) for (const line of value) show(line);
      } catch (error) {
        if (error instanceof FlightInterruptedError)
          show({ connector: connector.name, status: 'interrupted' });
        else if (error instanceof FlightFailedError)
          show(failed(connector, error.failure.message, 0));
        else errors.push(error);
      }
    });
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        errors
          .map((error) =>
            Error.isError(error) ? error.message : String(error),
          )
          .join('\n'),
      );
  }

  // Keeps each selected connector's import current, or only those named: a
  // pass at once, then one for each change its source reports, until Ctrl-C
  // or SIGTERM stops it. Each second it reads the selection and starts a
  // watch for each import it does not watch yet; with nothing selected it
  // waits for a setup. One process owns an import at a time: a watch that
  // finds another owner, a sync running a pass or another watch, waits and
  // owns the import once that one ends or dies. An import's watch ends on its
  // own once a setup removes or narrows its connector, and a setup that
  // selects it again starts a new one; or once its source's change signals
  // cannot be declared or break the contract.
  async watch(
    only: readonly string[] | undefined,
    observer: WatchObserver,
  ): Promise<void> {
    using settings = new Settings(this.root);
    for (const name of only ?? [])
      if (!settings.selections().some(({ connector }) => connector === name))
        throw new Error(`${name} is not set up; run: setup`);
    await this.#parsing.prepare();
    {
      await using flights = this.#flights();
      await removeStale(settings, flights);
    }
    using _ = interruptible(observer);
    const watched = new Set<string>();
    // A watch failed in a way no pass recorded, as when an import's sync
    // history cannot install itself: the whole watch fails with it.
    const broken = new AbortController();
    let idle = false;
    observer.start();
    while (!broken.signal.aborted) {
      const wanted = settings
        .selections()
        .filter(({ connector }) => only?.includes(connector) ?? true);
      if (wanted.length === 0 && !idle) observer.unselected();
      idle = wanted.length === 0;
      for (const selection of wanted) {
        const directory = settings.directory(selection);
        if (watched.has(directory)) continue;
        watched.add(directory);
        const connector = this.#loaded(selection.connector);
        // A selected connector that is not loaded cannot be watched; status
        // says so, and the others are still watched.
        if (connector === undefined)
          settings.saveConnectionFailure(
            selection,
            unloaded(selection.connector),
            'system',
          );
        else
          keepCurrent(
            {
              settings,
              connector,
              selection,
              show: shown(observer, connector),
            },
            observer,
          ).then(
            (removed) => {
              if (removed) watched.delete(directory);
            },
            (error: unknown) => broken.abort(error),
          );
      }
      await sleep(followMs, undefined, { signal: broken.signal }).catch(
        () => undefined,
      );
    }
    throw broken.signal.reason;
  }

  // Keeps every selected connector current with no terminal, as watch does:
  // from now on, from each login on, and again whenever that watch dies.
  async installWatch(): Promise<BackgroundWatch> {
    await this.#background.install();
    return this.#background;
  }

  async uninstallWatch(): Promise<void> {
    await this.#background.uninstall();
  }

  // The selection, less the imports it no longer names; each selected
  // connector, or each one named, run side by side and shown through the
  // observer; Ctrl-C and SIGTERM; and the exit status.
  async #each(
    only: readonly string[] | undefined,
    observer: SyncObserver,
    each: (run: ImportRun) => Promise<void>,
  ): Promise<void> {
    using settings = new Settings(this.root);
    const selections = selected(settings);
    // Syncs and watches read the files they store.
    await this.#parsing.prepare();
    await using flights = this.#flights();
    await removeStale(settings, flights);
    const imports = [];
    // A selected connector that is not loaded cannot sync; status says so,
    // and the others still sync.
    let unsynced = false;
    for (const name of only ?? selections.map(({ connector }) => connector)) {
      const selection = selections.find(({ connector }) => connector === name);
      if (selection === undefined)
        throw new Error(`${name} is not set up; run: setup`);
      const connector = this.#loaded(name);
      if (connector === undefined) {
        settings.saveConnectionFailure(selection, unloaded(name), 'system');
        unsynced = true;
      } else imports.push({ connector, selection });
    }
    using _ = interruptible(observer);
    const passes: PassSummary[] = [];
    const show = (connector: Connector) => (line: SyncLine) => {
      if (line.status === 'interrupted') unsynced = true;
      else if (line.status !== 'removed' && line.status !== 'watched')
        passes.push(line);
      shown(observer, connector)(line);
    };
    observer.start();
    await Promise.all(
      imports.map(({ connector, selection }) =>
        each({
          settings,
          flights,
          connector,
          selection,
          show: show(connector),
        }),
      ),
    );
    observer.finish();
    process.exitCode =
      !unsynced &&
      passes.every(({ status }) => ['succeeded', 'cancelled'].includes(status))
        ? 0
        : 1;
  }

  // Every connector, enabled ones first: disabled connectors have no sync
  // state; enabled ones show their connection failure, each stream whose
  // latest attempt failed, or else their import's latest pass.
  status(): ConnectorStatus[] {
    using settings = new Settings(this.root);
    const selections = settings.selections();
    const statuses: ConnectorStatus[] = selections.map((selection) => {
      const connector = this.#loaded(selection.connector);
      const path = settings.database(selection);
      const base = {
        connector: selection.connector,
        title: connector?.title ?? selection.connector,
        enabled: true,
        // A connector that is not loaded cannot describe the saved scope.
        selection:
          connector === undefined
            ? 'its saved selection'
            : connector.describe(selection.scope),
        database: existsSync(path) ? path : null,
      };
      const never = {
        ...base,
        state: 'never' as const,
        completedAt: null,
        lastSuccessAt: null,
        currentAsOf: null,
        error: null,
        streams: [],
      };
      if (connector === undefined)
        return {
          ...never,
          state: 'failed' as const,
          error: unloaded(selection.connector),
        };
      const failure = settings.connectionFailure(selection);
      if (failure !== undefined)
        return {
          ...never,
          state: 'failed' as const,
          completedAt: failure.failedAt,
          error: failure.error,
        };
      const { pass, streams } = readPassStatus(path);
      // Not synced yet, or no pass began.
      if (pass === null) return never;
      // A pass reads only the streams whose change signal changed, so a
      // stream's latest attempt can be older than the latest pass.
      const failures = streams.filter((stream) => stream.error !== null);
      let state = pass.state;
      if (failures.length > 0) {
        const everyStreamFailed =
          failures.length === streams.length &&
          failures.every((stream) => stream.state === 'failed');
        state = everyStreamFailed ? 'failed' : 'partial';
      }
      return {
        ...base,
        state,
        completedAt: pass.completedAt,
        lastSuccessAt: pass.lastSucceededAt,
        currentAsOf: pass.currentAsOf,
        error: failures.length === 0 ? pass.error : streamFailures(failures),
        streams: streams.map(
          ({ stream, state, lastSucceededAt, currentAsOf }) => ({
            stream,
            state,
            lastSuccessAt: lastSucceededAt,
            currentAsOf,
          }),
        ),
      };
    });
    const enabled = new Set(selections.map(({ connector }) => connector));
    return [
      ...statuses,
      ...this.connectors
        .filter(({ name }) => !enabled.has(name))
        .map(({ name, title }) => ({
          connector: name,
          title,
          enabled: false,
          selection: null,
          database: null,
          state: null,
          completedAt: null,
          lastSuccessAt: null,
          currentAsOf: null,
          error: null,
          streams: [],
        })),
    ];
  }
}

// Each distinct error of the streams whose latest attempt failed, once, with
// the streams that failed with it, as elt's describeFailures names a pass's
// copies: a store that refuses five streams gives its remedy once.
function streamFailures(
  failures: readonly { readonly stream: string; readonly error: string }[],
): string {
  const failed = new Map<string, string[]>();
  for (const { stream, error } of failures)
    failed.getOrInsertComputed(error, () => []).push(stream);
  return Array.from(
    failed,
    ([error, streams]) => `${streams.join(', ')}: ${error}`,
  ).join('; ');
}

// Ctrl-C and SIGTERM for a sync or a watch, until disposed. The signal ends
// the process the default way: process.exit would first wait for a source
// stuck in a filesystem call, such as a pipe no one writes, and never return.
// A listener left for the signal, such as this one when clack exits, would
// take it instead, and it would be lost.
function interruptible(observer: SyncObserver): Disposable {
  const interrupt = (signal: NodeJS.Signals) => {
    observer.interrupted();
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  // In a terminal clack's spinner reads Ctrl-C itself and exits with 0,
  // which no finished sync does.
  const cancelled = (code: number) => {
    if (code === 0) interrupt('SIGINT');
  };
  process.on('exit', cancelled);
  return { [Symbol.dispose]: () => process.off('exit', cancelled) };
}

// Shows one line of an import through the observer: a pass, or an import
// that was not loaded.
function shown(observer: SyncObserver, connector: Connector) {
  return (line: SyncLine) => {
    if (
      line.status === 'removed' ||
      line.status === 'interrupted' ||
      line.status === 'watched'
    )
      observer.skipped(connector, line.status);
    else observer.passed(connector, line);
  };
}

// Owns the import once no other process does, then watches it until the
// watch ends on its own, and says whether a setup removed its connector. A
// watch the removal ended removes its import while it still owns it, so a
// later setup of the same connector loads it from the start.
async function keepCurrent(
  run: Omit<ImportRun, 'flights'>,
  observer: WatchObserver,
): Promise<boolean> {
  const { settings, connector, selection, show } = run;
  const directory = settings.directory(selection);
  const election = owners(settings, directory);
  // Every owner stops once its connector is removed, so a watch that waits
  // always gets the import, and then hears of the removal itself.
  let owner = await election.campaign();
  if (owner === undefined) observer.waiting(connector);
  while (owner === undefined)
    owner = await election.campaign({ timeout: Number.POSITIVE_INFINITY });
  // Held until the watch ends; the kernel frees it if the process dies.
  await using _ = owner;
  using observed = new WatchPasses(connector, {
    progress: (...args) => observer.progress(...args),
    passed: (_, summary) => show(summary),
  });
  const outcome = await observed.run(() =>
    connector.watch(settings, selection),
  );
  if (outcome.status === 'unconnected')
    show(failed(connector, outcome.error, 0));
  else if (outcome.status === 'removed')
    show({ connector: connector.name, status: 'removed' });
  else observer.stopped(connector);
  if (settings.staleImports().includes(directory))
    rmSync(directory, { recursive: true, force: true });
  return outcome.status === 'removed';
}

// The selection a sync runs, which must name a connector.
function selected(settings: Settings): Selection[] {
  const selections = settings.selections();
  if (selections.length === 0)
    throw new Error('No connectors are set up; run: setup');
  return selections;
}

// Why a selected connector cannot be used, and what to do about it.
function unloaded(name: string): string {
  return `No connector named ${name} is loaded: fix or restore its folder in ${userConnectors}, or set up without it.`;
}

// Who owns an import: the process holding its claim, a sync for one pass or a
// sync watch until it stops. The claim sits at the store's root, beside the
// settings, so the removal of an import's folder never deletes a claim a
// waiting watch holds open.
function owners(settings: Settings, directory: string): SqliteElection {
  const name = relative(settings.root, directory).replaceAll(sep, '.');
  return new SqliteElection({
    directory: settings.root,
    claimFile: `${name}.owner.lock`,
    epochFile: `${name}.owner.epoch`,
    clock: globalThis,
  });
}

// Removes each import the selection no longer names, unless a sync runs its
// pass now or a sync watch still owns it: joining that pass's flight gives up
// the wait at once, a watch hears of the removal within a second, and the next
// setup or sync removes it. While a removal runs, a sync of the import waits.
async function removeStale(
  settings: Settings,
  flights: SingleFlight<readonly SyncLine[]>,
): Promise<void> {
  for (const directory of settings.staleImports()) {
    const joined = new AbortController();
    await flights
      .run(
        directory,
        async () => {
          await using owner = await owners(settings, directory).campaign();
          if (owner !== undefined)
            rmSync(directory, { recursive: true, force: true });
          return [];
        },
        { onJoin: () => joined.abort(), signal: joined.signal },
      )
      .catch((error: unknown) => {
        if (!joined.signal.aborted) throw error;
      });
  }
}
