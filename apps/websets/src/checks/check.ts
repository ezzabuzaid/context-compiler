import store, { type MonitorChange } from '../store.ts';

// How a read of a target went: what it read, or why it could not.
export type Read<T> = { readonly value: T } | { readonly failure: string };

// One run of a monitor: it reads its target now, then, in one transaction,
// keeps what it read as the baseline of the next run, reports what changed
// since the last, and records the run. A read that fails records the run with
// its reason and keeps the baseline.
export abstract class Check<T> {
  protected readonly monitor: string;

  constructor(monitor: string) {
    this.monitor = monitor;
  }

  async run(signal: AbortSignal): Promise<void> {
    const read = await this.read(signal);
    if ('failure' in read) {
      store.checkFailed(this.monitor, read.failure);
      console.log(`could not check ${this.monitor}: ${read.failure}`);
      return;
    }
    store.transaction(() => {
      const change = this.record(read.value);
      if (change !== null) {
        store.append(this.monitor, change);
      }
      store.checked(this.monitor);
    });
  }

  // Reads the target now. A failure of the target itself, such as a missing
  // page, is a failed read; any other error propagates.
  protected abstract read(signal: AbortSignal): Promise<Read<T>>;

  // Keeps what the run read as the baseline of the next, and gives what
  // changed since the last baseline, or null.
  protected abstract record(value: T): MonitorChange | null;
}
