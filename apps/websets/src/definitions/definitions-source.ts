import {
  Catalog,
  type CopyConfiguration,
  Source,
  type SourceMessage,
  type Stream,
} from '@eltjs/elt';

import { DefinitionsScan } from './definitions-scan.ts';
import type { DefinitionsReader } from './definitions-stream.ts';
import { StoreVersion } from './store-version.ts';
import { DatasetCriteriaStream } from './streams/dataset-criteria-stream.ts';
import { DatasetFieldsStream } from './streams/dataset-fields-stream.ts';
import { DatasetInputsStream } from './streams/dataset-inputs-stream.ts';

const readers = {
  inputs: new DatasetInputsStream(),
  criteria: new DatasetCriteriaStream(),
  fields: new DatasetFieldsStream(),
} satisfies Record<string, DefinitionsReader>;
const catalog = new Catalog(
  Object.values(readers).map((reader) => reader.describe()),
);
const readersByName = new Map<string, DefinitionsReader>(
  Object.values(readers).map((reader) => [reader.name, reader]),
);
// How often a watch checks api.sqlite for a commit of the API.
const pollIntervalMs = 1000;

// What the consumers asked, as the API keeps it in api.sqlite: the starting
// URLs, the criteria and the fields of each dataset. The pipeline copies them
// into the warehouse, beside the pages, so one view joins each page with what
// each dataset asks of it, and a new dataset needs no new pipeline (elt ADR
// 0001: derived data is made from what the pipeline wrote).
export class DefinitionsSource extends Source<DefinitionsScan> {
  readonly identity = 'websets-definitions';
  protected readonly catalog = catalog;
  readonly inputs = catalog.get(readers.inputs.name);
  readonly criteria = catalog.get(readers.criteria.name);
  readonly fields = catalog.get(readers.fields.name);

  readonly #path: string;

  constructor(path: string) {
    super();
    this.#path = path;
    Object.freeze(this);
  }

  protected override async open(): Promise<DefinitionsScan> {
    return new DefinitionsScan(this.#path);
  }

  override coverage(_stream: Stream) {
    return {
      description:
        'Every dataset that the API keeps, with its starting URLs, criteria and fields.',
      selection: {},
    };
  }

  override async currentAsOf() {
    return null;
  }

  override changeSignals(streams: readonly Stream[]) {
    return [
      {
        gauge: new StoreVersion(this.#path),
        streams,
        interval: pollIntervalMs,
        // A data_version read is local: a check that takes the whole interval
        // is stuck.
        timeout: pollIntervalMs,
      },
    ];
  }

  protected override async *extract(
    configuration: CopyConfiguration,
    _state: unknown,
    _partition: null,
    scan: DefinitionsScan,
  ): AsyncGenerator<SourceMessage> {
    const { stream } = configuration;
    const reader = readersByName.get(stream.name);
    if (reader === undefined) {
      throw new Error(`The definitions have no stream ${stream.name}`);
    }
    for (const data of reader.read(scan)) {
      yield { stream: stream.name, data };
    }
  }
}
