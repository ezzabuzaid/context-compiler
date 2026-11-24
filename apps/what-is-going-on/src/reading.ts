import { BackgroundService } from '@zukhruf/async';

import pipeline from './pipeline.ts';
import type { Source } from './sources.ts';

// The watch of the pipeline that reads the sources. A blog's posts pattern is
// in the include of its web stream, and the sources make its revisit policy,
// which a WebStream takes when it is made, so a new site stops the watch and
// starts a new pipeline over the full list (elt's apps/web builds its pipeline
// per sync for its include patterns). The checkpoints carry each input's crawl
// over.
export class Reading implements AsyncDisposable {
  readonly #sources: readonly Source[];
  #watch: BackgroundService;

  constructor(sources: readonly Source[]) {
    this.#sources = sources;
    this.#watch = this.#start();
  }

  // Reads the sources again, the added ones too.
  async restart() {
    await this.#stop();
    this.#watch = this.#start();
  }

  async [Symbol.asyncDispose]() {
    await this.#stop();
  }

  // A watch that fails is reported when it fails, and the server goes on.
  #start() {
    const watch = BackgroundService.start((signal) =>
      read(this.#sources, signal),
    );
    void watch.ended.catch((error: unknown) => console.error(error));
    return watch;
  }

  // The start reported the failure of the watch, if one came, so a stop only
  // waits for its end.
  async #stop() {
    await Promise.allSettled([this.#watch[Symbol.asyncDispose]()]);
  }
}

async function read(sources: readonly Source[], signal: AbortSignal) {
  const reader = await pipeline({ sources });
  for await (const event of reader.watch({ signal })) {
    // A derived dataset that failed fails alone; the passes go on.
    if (event.kind === 'refresh') {
      console.log(`could not refresh ${event.dataset}: ${String(event.error)}`);
      continue;
    }
    const { connection, outcomes } = event;
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
  }
}
