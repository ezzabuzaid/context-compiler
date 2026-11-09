import {
  type Properties,
  type RecordDraft,
  type SchemaRecord,
  Stream,
  type SyncMode,
  validateRecords,
} from '@eltjs/elt';

import type { Asked, DefinitionsScan } from './definitions-scan.ts';

// What the source needs from any stream of the definitions.
export type DefinitionsReader = {
  readonly name: string;
  describe(): Stream;
  read(scan: DefinitionsScan): Iterable<Record<string, unknown>>;
};

// A table of what the consumers asked. Every stream reads each dataset of the
// scan, projects it and validates the records against its schema, so a
// stream gives only its schema and its projection. The tables are small and
// a pass reads them whole, so each pass replaces them (Airbyte's full refresh
// with overwrite), and a deleted dataset leaves no row.
export abstract class DefinitionsStream<P extends Properties> {
  abstract readonly name: string;
  abstract readonly jsonSchema: {
    readonly type: 'object';
    readonly description: string;
    readonly properties: P;
    readonly required: string[];
  };
  abstract readonly primaryKey: readonly string[];
  readonly supportedSyncModes: readonly SyncMode[] = Object.freeze([
    'full_refresh',
  ]);

  // A new Stream each call: the source asks once, for its catalog.
  describe(): Stream {
    return new Stream(this);
  }

  *read(scan: DefinitionsScan): Generator<SchemaRecord<P>> {
    for (const dataset of scan.datasets()) {
      yield* validateRecords(this, this.records(dataset), 'Websets');
    }
  }

  protected abstract records(dataset: Asked): RecordDraft<P>[];
}
