import { ChangeWatcher } from '@zukhruf/async';
import { ClosedWorld } from '@zukhruf/snapshot-differential';
import { DataVersion } from '@zukhruf/sqlite-data-version';
import { UnavailableError, open } from '@zukhruf/sqlite-open';

import {
  Catalog,
  type CopyConfiguration,
  type ExtractionCoverage,
  type Properties,
  Source,
  type SourceMessage,
  type SourceWatchOptions,
  type Stream,
  diffSnapshot,
} from '@workspace/elt';

import { type ImportConnector, ImportUnavailableError } from '../imports.ts';
import type { ImportStream } from './import-stream.ts';
import { ImportsScan } from './imports-scan.ts';
import { BankMessagesStream } from './streams/bank-messages-stream.ts';
import { InvoiceEmailsStream } from './streams/invoice-emails-stream.ts';

const readers = {
  invoiceEmails: new InvoiceEmailsStream(),
  bankMessages: new BankMessagesStream(),
};
const catalog = new Catalog(
  Object.values(readers).map((reader) => reader.describe()),
);
const readersByName = new Map<string, ImportStream<Properties>>(
  Object.values(readers).map((reader) => [reader.name, reader]),
);
// How often a watch checks the imports for commits.
const pollIntervalMs = 1000;

// Reads what ipay needs from the Context Compiler imports, which Context
// Compiler writes and ipay only reads: candidate invoices from Mail and the
// bank's texts from Messages.
export class ImportsSource extends Source<ImportsScan> {
  readonly identity = 'context-compiler-imports';
  protected readonly catalog = catalog;
  readonly invoiceEmails = catalog.get(readers.invoiceEmails.name);
  readonly bankMessages = catalog.get(readers.bankMessages.name);
  readonly #paths: Readonly<Record<ImportConnector, string>>;

  constructor(paths: Readonly<Record<ImportConnector, string>>) {
    super();
    this.#paths = paths;
    Object.freeze(this);
  }

  protected override async open(): Promise<ImportsScan> {
    return new ImportsScan(this.#paths);
  }

  protected override readonly configErrors = [
    UnavailableError,
    ImportUnavailableError,
  ];

  override coverage(stream: Stream): ExtractionCoverage {
    return {
      description: `Every matching row of the Context Compiler ${this.#reader(stream).connector} import, as it last synced`,
      selection: {},
    };
  }

  // As current as the import's least current stream that the rows come from,
  // by the import's own stream_status.
  override async currentAsOf(stream: Stream): Promise<Date | null> {
    const reader = this.#reader(stream);
    using database = open(this.#paths[reader.connector], { readOnly: true });
    const [row] = database
      .prepare(
        `SELECT min(current_as_of) AS at, count(current_as_of) AS known FROM stream_status WHERE stream IN (${reader.reads.map(() => '?').join(', ')})`,
      )
      .all(...reader.reads);
    if (row?.known !== reader.reads.length || typeof row.at !== 'string')
      throw new ImportUnavailableError(reader.connector);
    return new Date(row.at);
  }

  protected override async *observe({
    streams,
    signal,
    clock,
  }: SourceWatchOptions): AsyncGenerator<readonly Stream[]> {
    if (signal.aborted) return;
    using mail = new DataVersion(this.#paths.mail);
    using messages = new DataVersion(this.#paths.messages);
    const versions: readonly (readonly [ImportConnector, DataVersion])[] = [
      ['mail', mail],
      ['messages', messages],
    ];
    // The reads are local, so a check that takes the whole interval is stuck.
    const watcher = new ChangeWatcher([mail, messages], {
      interval: pollIntervalMs,
      timeout: pollIntervalMs,
      clock,
    });
    for await (const outcomes of watcher.watch(signal)) {
      const changedVersions = new Set<DataVersion>();
      for (const [version, outcome] of outcomes) {
        if (outcome.state === 'failed') throw outcome.error;
        if (outcome.state === 'changed') changedVersions.add(version);
      }
      const changed = versions
        .filter(([, version]) => changedVersions.has(version))
        .map(([connector]) => connector);
      yield streams.filter((stream) =>
        changed.includes(this.#reader(stream).connector),
      );
    }
  }

  protected override async *extract(
    configuration: CopyConfiguration,
    state: unknown,
    _partition: null,
    scan: ImportsScan,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<SourceMessage> {
    yield* diffSnapshot(
      configuration,
      this.#reader(configuration.stream).read(scan),
      state,
      { policy: new ClosedWorld(), signal },
    );
  }

  #reader(stream: Stream): ImportStream<Properties> {
    const reader = readersByName.get(stream.name);
    if (reader === undefined)
      throw new Error(`The imports source has no stream ${stream.name}`);
    return reader;
  }
}
