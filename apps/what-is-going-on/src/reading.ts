import pipeline from './pipeline.ts';
import type { Source } from './sources.ts';

// The watch of the pipeline that reads the sources. A WebSource's inputs are
// fixed at construction, so a new site stops the watch and starts a new
// pipeline over the full list (elt's apps/web builds its pipeline per sync for
// the same reason). The checkpoints carry each input's crawl over.
class Reading {
  #options: { sources: readonly Source[]; embeddings: string } | undefined;
  #watch: { stop: AbortController; ended: Promise<void> } | undefined;

  start(options: { sources: readonly Source[]; embeddings: string }) {
    this.#options = options;
    const stop = new AbortController();
    this.#watch = { stop, ended: watch(options, stop.signal) };
  }

  // Reads the sources again, the added ones too; nothing when no watch runs.
  async restart() {
    const options = this.#options;
    if (options === undefined) return;
    await this.stop();
    this.start(options);
  }

  async stop() {
    this.#watch?.stop.abort();
    await this.#watch?.ended;
    this.#watch = undefined;
  }
}

async function watch(
  options: { sources: readonly Source[]; embeddings: string },
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
