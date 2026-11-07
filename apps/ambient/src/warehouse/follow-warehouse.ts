import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { ChangeWatcher } from '@zukhruf/async';
import {
  Baseline,
  type ChangeEvent,
  Changefeed,
  PositionFile,
} from '@zukhruf/sqlite-changefeed';
import { DataVersion } from '@zukhruf/sqlite-data-version';

import type { Warehouse } from './warehouse.ts';

// Own subscriptions, not change detection: the native feed owns snapshots,
// polling, positions and the acknowledgement of each accepted batch.
export async function followWarehouse(
  warehouse: Warehouse,
  directory: string,
  signal: AbortSignal,
  accept: (source: string, changes: ChangeEvent[]) => Promise<void>,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stopped = new AbortController();
  const lifetime = AbortSignal.any([signal, stopped.signal]);
  const failure = Promise.withResolvers<never>();
  const sources = new Map<
    string,
    { stop: AbortController; done: Promise<void> }
  >();

  async function reconcile() {
    const selected = new Map(
      warehouse
        .sources()
        .map((source) => [
          JSON.stringify([source.name, source.database]),
          source,
        ]),
    );
    for (const [key, worker] of sources) {
      if (selected.has(key)) continue;
      worker.stop.abort();
      await worker.done;
      sources.delete(key);
    }
    for (const [key, source] of selected) {
      if (sources.has(key)) continue;
      const stop = new AbortController();
      const sourceSignal = AbortSignal.any([lifetime, stop.signal]);
      const position = join(
        directory,
        `${createHash('sha256').update(key).digest('hex')}.sqlite`,
      );
      const done = (async () => {
        // A notice is about a change, not about the rows that were there
        // before Ambient first ran: the first pass is a baseline.
        using feed = new Changefeed(source.database, {
          position: new PositionFile(position),
          start: new Baseline(),
        });
        for await (const changes of feed.watch({
          interval: 1000,
          signal: sourceSignal,
          clock: globalThis,
        })) {
          await accept(source.name, changes);
        }
      })().catch((error) => {
        if (sourceSignal.aborted && error === sourceSignal.reason) return;
        failure.reject(error);
      });
      sources.set(key, { stop, done });
    }
  }

  const settings = (async () => {
    // Selection needs a fresh view, not a historical row stream or position.
    using version = new DataVersion(warehouse.settingsPath);
    // The read is local, so a check that takes the whole interval is stuck.
    const watcher = new ChangeWatcher([version], {
      interval: 1000,
      timeout: 1000,
      clock: globalThis,
    });
    for await (const outcomes of watcher.watch(lifetime))
      for (const outcome of outcomes.values()) {
        if (outcome.state === 'failed') throw outcome.error;
        if (outcome.state === 'changed') await reconcile();
      }
  })();
  try {
    await Promise.race([settings, failure.promise]);
  } catch (error) {
    if (!lifetime.aborted || error !== lifetime.reason) throw error;
  } finally {
    stopped.abort();
    await Promise.allSettled([
      settings,
      ...Array.from(sources.values(), (worker) => worker.done),
    ]);
  }
}
