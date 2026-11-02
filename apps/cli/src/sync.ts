import { AsyncLocalStorage } from 'node:async_hooks';

import type { Connector } from '@workspace/connector/connector';
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
} from '@workspace/elt';

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

// Shows the report of each pass of one connector that runs inside run(): each
// copy's progress while it runs, and how the pass ended once the import's
// sync history recorded it.
export class ObservedPasses implements Disposable {
  readonly #connector: Connector;
  readonly #report: PassReport;
  #started = performance.now();
  readonly #hear = (message: unknown) => {
    if (running.getStore() !== this) return;
    const connector = this.#connector;
    if (message instanceof PassStarted) this.#started = performance.now();
    if (message instanceof CopyProgress)
      this.#report.progress(connector, message);
    if (message instanceof PassFinished)
      this.#report.passed(
        connector,
        summarize(
          connector,
          message.outcomes,
          Math.round((performance.now() - this.#started) / 1000),
        ),
      );
    // A connection that gave no pass took no time.
    if (message instanceof PassFailed)
      this.#report.passed(
        connector,
        failed(connector, message.error, 0, message.failureType),
      );
  };

  constructor(connector: Connector, report: PassReport) {
    this.#connector = connector;
    this.#report = report;
    for (const channel of Object.values(passChannels))
      channel.subscribe(this.#hear);
  }

  run<T>(load: () => Promise<T>): Promise<T> {
    return running.run(this, load);
  }

  [Symbol.dispose]() {
    for (const channel of Object.values(passChannels))
      channel.unsubscribe(this.#hear);
  }
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
  error instanceof Error ? error.message : String(error);
