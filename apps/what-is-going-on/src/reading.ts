import { Latch } from '@zukhruf/async';

import pipeline from './pipeline.ts';
import type { Source } from './sources.ts';

// The watch of the pipeline that reads the sources. A WebSource's inputs are
// fixed at construction, so a new site stops the watch and starts a new
// pipeline over the full list (elt's apps/web builds its pipeline per sync for
// the same reason). The checkpoints carry each input's crawl over.
class Reading {
  #state: Idle | Watching | Stopped = new Idle();

  start(options: { sources: readonly Source[] }) {
    this.#state = new Watching(options);
  }

  // Reads the sources again, the added ones too; nothing when no watch runs.
  async restart() {
    if (this.#state instanceof Idle) return;
    const { options } = this.#state;
    await this.stop();
    this.start(options);
  }

  async stop() {
    const state = this.#state;
    if (!(state instanceof Watching)) return;
    state.stop.abort();
    await state.ended.wait();
    this.#state = new Stopped(state.options);
  }
}

// Before the first start.
class Idle {}

// A watch over the sources, until stop is aborted and the watch has ended.
class Watching {
  readonly options: { sources: readonly Source[] };
  readonly stop = new AbortController();
  readonly ended = new Latch();

  constructor(options: { sources: readonly Source[] }) {
    this.options = options;
    void watch(options, this.stop.signal).then(() => this.ended.open());
  }
}

// After a stop: restart reads the same sources again.
class Stopped {
  readonly options: { sources: readonly Source[] };

  constructor(options: { sources: readonly Source[] }) {
    this.options = options;
  }
}

async function watch(
  options: { sources: readonly Source[] },
  signal: AbortSignal,
) {
  try {
    const reader = await pipeline(options);
    for await (const { connection, outcomes } of reader.watch({ signal }))
      for (const { count, deleted, failures } of outcomes)
        console.log(
          `${connection.name}: ${count} written, ${deleted} deleted${
            failures.length === 0
              ? ''
              : `, ${failures.length} failed: ${failures
                  .map(({ error }) => String(error))
                  .join('; ')
                  .slice(0, 500)}`
          }`,
        );
  } catch (error) {
    // A watch stopped on purpose ends with what it recorded; only an
    // unexpected end is reported.
    if (!signal.aborted) console.error(error);
  }
}

export default new Reading();
