import {
  PassFailed,
  PassFinished,
  PassStarted,
  passChannels,
} from '@workspace/elt';

// The app's watch as the queries see it. A WebSource takes its starting URLs
// when it is made, so a query that adds or removes seeds or criteria ends
// the watch, and the app builds the pipeline again (elt #3679). Until elt
// can add a starting URL to a running crawl, a query cannot change the
// watch while a pass runs.
class Crawl {
  // The connections whose pass runs now.
  readonly #passes = new Set<string>();
  #watch = new AbortController();

  constructor() {
    passChannels.start.subscribe((message) => {
      if (message instanceof PassStarted) {
        this.#passes.add(message.connection.name);
      }
    });
    for (const channel of [passChannels.finish, passChannels.failure]) {
      channel.subscribe((message) => {
        if (message instanceof PassFinished || message instanceof PassFailed) {
          this.#passes.delete(message.connection.name);
        }
      });
    }
  }

  get passing(): boolean {
    return this.#passes.size > 0;
  }

  // The signal that ends the watch of the pipeline that the app builds now.
  watch(): AbortSignal {
    this.#watch = new AbortController();
    return this.#watch.signal;
  }

  rebuild(): void {
    this.#watch.abort();
  }
}

export default new Crawl();
