import {
  PassFailed,
  PassFinished,
  PassStarted,
  passChannels,
} from '@workspace/elt';
import { WebSource } from '@workspace/source-web-pages/web-source';

// A pass that a new pipeline would cut off is a crawl's: the definitions'
// pass is short and reads api.sqlite again in the next pipeline.
const crawls = ({ source }: PassStarted['connection']) =>
  source instanceof WebSource;

// The app's watch as the datasets see it. A WebSource takes its starting URLs
// when it is made, so a dataset that changes the starting URLs ends
// the watch, and the app builds the pipeline again (elt #3679). Until elt
// can add a starting URL to a running crawl, a dataset cannot change the
// watch while a pass runs: the API refuses it (Ezz, 2026-11-02).
class Crawl {
  // The crawl connections whose pass runs now.
  readonly #passes = new Set<string>();
  #watch = new AbortController();

  constructor() {
    passChannels.start.subscribe((message) => {
      if (message instanceof PassStarted && crawls(message.connection)) {
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
