import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { ChangeEvent } from '@zukhruf/sqlite-changefeed';
import { open } from '@zukhruf/sqlite-open';
import { transaction } from '@zukhruf/sqlite-transaction';

import type { Decision } from '../contracts/decision.ts';
import { type Evidence, evidenceSchema } from '../contracts/evidence.ts';
import tables from './tables.ts';

export class Journal implements Disposable {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = open(path);
    tables.apply(this.#db);
  }

  capture(source: string, change: ChangeEvent): Evidence {
    // SQLite integers can be bigint; JSON strings preserve their exact digits.
    const serialized = JSON.stringify(change, (_, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    const fingerprint = createHash('sha256').update(serialized).digest('hex');
    const data: unknown = JSON.parse(serialized);
    const key =
      change.op === 'truncate'
        ? null
        : JSON.stringify(change.key, (_, value: unknown) =>
            typeof value === 'bigint' ? value.toString() : value,
          );
    return transaction(
      this.#db,
      () => {
        // A native batch may replay before its position advances. Compare only
        // the latest row state so a later A -> B -> A remains a new event.
        const previous = this.#db
          .prepare(
            'SELECT fingerprint,event FROM changes WHERE source=? AND table_name=? AND (? IS NULL OR key IS ? OR key IS NULL) ORDER BY seq DESC LIMIT 1',
          )
          .get(source, change.table, key, key);
        if (previous?.fingerprint === fingerprint)
          return evidenceSchema.parse(JSON.parse(String(previous.event)));
        const event = { id: randomUUID(), source, data };
        this.#db
          .prepare(
            'INSERT INTO changes(id,fingerprint,source,table_name,key,event,received_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            event.id,
            fingerprint,
            source,
            change.table,
            key,
            JSON.stringify(event),
            new Date().toISOString(),
          );
        return event;
      },
      { mode: 'immediate' },
    );
  }

  linked(id: string): boolean {
    return (
      this.#db.prepare('SELECT 1 FROM turns WHERE id=?').get(id) !== undefined
    );
  }

  link(id: string, streamId: string): void {
    this.#db
      .prepare('INSERT OR IGNORE INTO turns VALUES(?,?)')
      .run(id, streamId);
  }

  unlinked(): Evidence[] {
    return this.#db
      .prepare(
        'SELECT event FROM changes LEFT JOIN turns USING(id) WHERE turns.id IS NULL AND decision IS NULL AND failure IS NULL ORDER BY seq',
      )
      .all()
      .map((row) => evidenceSchema.parse(JSON.parse(String(row.event))));
  }

  unrecorded(): { id: string; streamId: string }[] {
    return this.#db
      .prepare(
        'SELECT o.id,t.stream_id FROM changes o JOIN turns t USING(id) WHERE decision IS NULL AND failure IS NULL ORDER BY seq',
      )
      .all()
      .map((row) => ({ id: String(row.id), streamId: String(row.stream_id) }));
  }

  finish(
    id: string,
    decision: Decision,
    evidence: Evidence[],
    duration: number,
  ): void {
    transaction(
      this.#db,
      () => {
        const result = this.#db
          .prepare(
            'UPDATE changes SET decision=?,evidence=?,duration_ms=? WHERE id=? AND decision IS NULL AND failure IS NULL',
          )
          .run(
            JSON.stringify(decision),
            JSON.stringify(evidence),
            duration,
            id,
          );
        if (result.changes === 0) return;
        if (decision.kind === 'notify')
          this.#db
            .prepare('INSERT INTO notifications VALUES(?,?,?,?)')
            .run(
              id,
              decision.message,
              JSON.stringify(
                evidence.filter((item) =>
                  decision.evidenceIds.includes(item.id),
                ),
              ),
              new Date().toISOString(),
            );
      },
      { mode: 'immediate' },
    );
  }

  fail(id: string, error: string): void {
    this.#db
      .prepare(
        'UPDATE changes SET failure=? WHERE id=? AND decision IS NULL AND failure IS NULL',
      )
      .run(error, id);
  }

  notifications(): {
    id: string;
    message: string;
    evidence: unknown;
    createdAt: string;
  }[] {
    return this.#db
      .prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100')
      .all()
      .map((row) => ({
        id: String(row.id),
        message: String(row.message),
        evidence: JSON.parse(String(row.evidence)),
        createdAt: String(row.created_at),
      }));
  }

  decisions(): unknown[] {
    return this.#db
      .prepare(
        'SELECT id,event,received_at,decision,failure,duration_ms FROM changes ORDER BY seq DESC LIMIT 100',
      )
      .all()
      .map((row) => ({
        ...row,
        event: evidenceSchema.parse(JSON.parse(String(row.event))),
        decision:
          row.decision === null ? null : JSON.parse(String(row.decision)),
      }));
  }

  [Symbol.dispose](): void {
    this.#db.close();
  }
}
