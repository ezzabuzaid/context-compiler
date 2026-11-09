import { AsyncLocalStorage } from 'node:async_hooks';

import {
  type CopyOutcome,
  CopyProgress,
  type FailureType,
  PassFailed,
  PassFinished,
  PassStarted,
  type SyncStatus,
  type Target,
  passChannels,
  passError,
  passFailureType,
  passStatus,
} from '@eltjs/elt';
import type { Connector } from '@workspace/connector/connector';

// How one pass of one connector ended, as sync reports it.
export type PassSummary = {
  readonly connector: string;
  readonly status: SyncStatus;
  readonly seconds: number;
  readonly streams: readonly {
    readonly stream: string;
    readonly written: number;
    readonly deleted: number;
    readonly errors: readonly string[];
  }[];
  readonly error: string | null;
};

// One line a sync shows for an import: how its pass ended; removed, another
// setup removed its connector while it ran; interrupted, the sync whose pass
// this one waited for stopped first; or watched, a sync watch keeps it
// current, so this sync runs no pass of it.
export type SyncLine =
  | PassSummary
  | { readonly connector: string; readonly status: 'removed' }
  | { readonly connector: string; readonly status: 'interrupted' }
  | { readonly connector: string; readonly status: 'watched' };

// What a sync shows of each pass while it runs and once it ends.
export type PassReport = {
  progress(connector: Connector, progress: CopyProgress): void;
  passed(connector: Connector, summary: PassSummary): void;
};

// The ObservedPasses whose run() a pass runs in. Several connectors sync in
// one process, and Node calls a subscriber in the async context of the pass
// that publishes.
const running = new AsyncLocalStorage<ObservedPasses>();

// How one connection's pass ended: its copies' outcomes, or the failure that
// gave it no pass.
type ConnectionPass =
  | { readonly outcomes: readonly CopyOutcome<Target>[] }
  | { readonly error: unknown; readonly failureType: FailureType };

// Hears the passes of one connector that run inside run(): it shows each
// copy's progress while it runs, and hands how each connection's pass ended,
// once the import's sync history recorded it, to the subclass. A connector
// with several sources runs one connection for each.
abstract class ObservedPasses implements Disposable {
  protected readonly connector: Connector;
  protected readonly report: PassReport;
  readonly #started = new Map<string, number>();
  readonly #hear = (message: unknown) => {
    if (running.getStore() !== this) return;
    if (message instanceof PassStarted)
      this.#started.set(message.connection.name, performance.now());
    if (message instanceof CopyProgress)
      this.report.progress(this.connector, message);
    if (message instanceof PassFinished)
      this.ended(message.connection.name, { outcomes: message.outcomes });
    if (message instanceof PassFailed)
      this.ended(message.connection.name, {
        error: message.error,
        failureType: message.failureType,
      });
  };

  constructor(connector: Connector, report: PassReport) {
    this.connector = connector;
    this.report = report;
    for (const channel of Object.values(passChannels))
      channel.subscribe(this.#hear);
  }

  run<T>(load: () => Promise<T>): Promise<T> {
    return running.run(this, load);
  }

  // The seconds since the connection's pass started; a connection that gave
  // no pass took none.
  protected seconds(connection: string): number {
    const started = this.#started.get(connection);
    return started === undefined
      ? 0
      : Math.round((performance.now() - started) / 1000);
  }

  protected abstract ended(connection: string, pass: ConnectionPass): void;

  [Symbol.dispose]() {
    for (const channel of Object.values(passChannels))
      channel.unsubscribe(this.#hear);
  }
}

// A sync runs one pass of the import, whatever number of sources its
// connector reads, so it shows one line for it once every connection's pass
// ended, as status reads the import: partial when one connection's copies
// failed and another's loaded. A retry runs each connection again, and its
// pass replaces the one before.
export class SyncPasses extends ObservedPasses {
  readonly #passes = new Map<string, ConnectionPass>();
  #first = performance.now();

  protected ended(connection: string, pass: ConnectionPass): void {
    if (this.#passes.size === 0) this.#first = performance.now();
    this.#passes.set(connection, pass);
  }

  override async run<T>(load: () => Promise<T>): Promise<T> {
    const value = await super.run(load);
    if (this.#passes.size > 0)
      this.report.passed(
        this.connector,
        combined(
          this.connector,
          [...this.#passes.values()],
          Math.round((performance.now() - this.#first) / 1000),
        ),
      );
    return value;
  }
}

// A watch runs a pass of a connection each time its source reports a change,
// so it shows a line for each.
export class WatchPasses extends ObservedPasses {
  protected ended(connection: string, pass: ConnectionPass): void {
    this.report.passed(
      this.connector,
      'outcomes' in pass
        ? summarize(this.connector, pass.outcomes, this.seconds(connection))
        : failed(this.connector, pass.error, 0, pass.failureType),
    );
  }
}

// The passes of a sync's connections as one: the copies of all of them, and
// a connection that gave no pass makes the whole pass partial when another
// loaded a copy, and failed when none did.
function combined(
  connector: Connector,
  passes: readonly ConnectionPass[],
  seconds: number,
): PassSummary {
  const outcomes = passes.flatMap((pass) =>
    'outcomes' in pass ? pass.outcomes : [],
  );
  const failures = passes.flatMap((pass) => ('error' in pass ? [pass] : []));
  const loaded = summarize(connector, outcomes, seconds);
  if (failures.length === 0) return loaded;
  return {
    ...loaded,
    status:
      outcomes.length === 0 || loaded.status === 'failed'
        ? 'failed'
        : 'partial',
    error: [
      ...(loaded.error === null ? [] : [loaded.error]),
      ...failures.map(({ error, failureType }) =>
        connector.failure(error, failureType),
      ),
    ].join('\n'),
  };
}

function summarize(
  connector: Connector,
  outcomes: readonly CopyOutcome<Target>[],
  seconds: number,
): PassSummary {
  const error = passError(outcomes);
  return {
    connector: connector.name,
    status: passStatus(outcomes),
    seconds,
    streams: outcomes.map(({ copy, count, deleted, failures }) => ({
      stream: copy.from.name,
      written: count,
      deleted,
      errors: failures.map(({ error }) => message(error)),
    })),
    error:
      error === null
        ? null
        : connector.failure(error, passFailureType(outcomes)),
  };
}

export function failed(
  connector: Connector,
  error: unknown,
  seconds: number,
  failureType: FailureType = connector.failureType(error),
): PassSummary {
  return {
    connector: connector.name,
    status: 'failed',
    seconds,
    streams: [],
    error: connector.failure(error, failureType),
  };
}

const message = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);
