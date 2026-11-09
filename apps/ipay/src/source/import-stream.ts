import type { SQLOutputValue } from 'node:sqlite';

import {
  type Properties,
  type RecordDraft,
  type SchemaRecord,
  Stream,
  type SyncMode,
  validateRecords,
} from '@eltjs/elt';

import type { ImportConnector } from '../imports.ts';
import type { ImportsScan } from './imports-scan.ts';

export type ImportRow = Record<string, SQLOutputValue>;

// A stream of the rows ipay copies from one Context Compiler import. Reading
// is the same for every stream: select the rows from the import's snapshot,
// shape each into a record, validate it against the schema; a stream gives
// the import, the rows and the shape.
export abstract class ImportStream<P extends Properties> {
  abstract readonly name: string;
  abstract readonly jsonSchema: {
    readonly type: 'object';
    readonly description: string;
    readonly properties: P;
    readonly required: string[];
  };
  abstract readonly primaryKey: readonly string[];
  abstract readonly connector: ImportConnector;
  // The import's streams the rows come from: the stream is as current as the
  // least current of them.
  abstract readonly reads: readonly string[];
  readonly supportedSyncModes: readonly SyncMode[] = Object.freeze([
    'full_refresh',
    'incremental',
  ]);
  // Every read selects every matching row, so incremental copies diff
  // snapshots.
  readonly sourceDefinedCursor = true;
  readonly emitsDeletes = true;

  describe(): Stream {
    return new Stream(this);
  }

  *read(scan: ImportsScan): Generator<SchemaRecord<P>> {
    for (const row of this.rows(scan))
      yield* validateRecords(this, [this.record(row)], 'ipay');
  }

  protected abstract rows(scan: ImportsScan): Iterable<ImportRow>;

  protected abstract record(row: ImportRow): RecordDraft<P>;
}
