import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';
import {
  Catalog,
  type ExtractionCoverage,
  Source,
  type SourceWatchOptions,
  Stream,
} from '@workspace/elt';

// A connector outside the library, as an agent writes one: TypeScript that
// Node runs as written, on the host's elt and Connector. It reads
// Pictures/photos.json in the host's home folder, a list of { id, title }, and checkpoints after each
// photo, so an entry that is not a photo fails the stream after the photos
// before it loaded.

const photos = new Stream({
  name: 'photos',
  jsonSchema: {
    type: 'object',
    description: 'One photo in the library.',
    properties: {
      id: { type: 'string', description: 'The photo identifier.' },
      title: { type: 'string', description: 'The photo title.' },
    },
  },
  primaryKey: ['id'],
  sourceDefinedCursor: true,
  supportedSyncModes: ['full_refresh', 'incremental'],
});

class PhotosSource extends Source {
  readonly identity = 'photos';
  readonly #home: string;

  constructor(home: string) {
    super();
    this.#home = home;
  }
  protected readonly catalog = new Catalog([photos]);

  coverage(): ExtractionCoverage {
    return { description: 'every photo in photos.json', selection: {} };
  }

  async currentAsOf() {
    return null;
  }

  protected async open() {
    return new AsyncDisposableStack();
  }

  protected async *observe({ streams }: SourceWatchOptions) {
    yield streams;
  }

  protected async *extract() {
    const listed: unknown = JSON.parse(
      await readFile(join(this.#home, 'Pictures/photos.json'), 'utf8'),
    );
    if (!Array.isArray(listed)) throw new TypeError('photos.json is a list');
    for (const photo of listed) {
      if (typeof photo !== 'object' || photo === null)
        throw new TypeError('Each entry in photos.json is a photo');
      yield { stream: 'photos', data: photo };
      yield { type: 'STATE' as const, stream: 'photos', state: {} };
    }
  }
}

export default class PhotosConnector extends Connector {
  readonly datedBy = null;
  readonly fullDiskAccess = true;
  protected readonly choices: readonly Choice[] = [];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(): string {
    return 'Open Photos once.';
  }

  protected source(): Source {
    return new PhotosSource(this.host.home);
  }
}
