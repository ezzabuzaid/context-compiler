import { DatabaseSync, type SQLTagStore } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';

import { z } from 'zod';

import type { Condition, Warehouse } from '@workspace/eca';

import {
  type StoredOffer,
  storedOffersSchema,
  valuedIdentities,
} from './offer.ts';

// The app's SQLite file as eca's warehouse, read only. A commit is any change
// another connection commits there, the copies' and the offer rule's, which
// PRAGMA data_version shows; SQLite tells a reader nothing, so it asks every
// second. The watch refreshes the offers after a pass, not before it yields
// the pass, so a commit of the pass alone would read the offers before it.
export class CreditsWarehouse implements Warehouse<SQLTagStore>, Disposable {
  readonly sql: SQLTagStore;
  readonly #database: DatabaseSync;

  constructor(path: string) {
    // A first run has no file yet; elt fills the one this makes.
    new DatabaseSync(path).close();
    this.#database = new DatabaseSync(path, { readOnly: true });
    this.sql = this.#database.createTagStore();
  }

  async *commits(signal: AbortSignal): AsyncIterable<unknown> {
    let version = this.#version();
    for (;;) {
      await setTimeout(1000, undefined, { signal });
      const next = this.#version();
      if (next === version) continue;
      version = next;
      yield;
    }
  }

  #version() {
    return this.#database.prepare('PRAGMA data_version').get()?.data_version;
  }

  [Symbol.dispose]() {
    this.#database.close();
  }
}

export type Alert =
  | {
      readonly kind: 'program';
      readonly page: string;
      readonly offers: readonly StoredOffer[];
    }
  | {
      readonly kind: 'failed';
      readonly step: 'label' | 'extract';
      readonly page: string;
      readonly reason: string;
    };

// Rows of a table that the first pass makes, and none before it.
function rows(read: () => Record<string, unknown>[]) {
  try {
    return read();
  } catch (error) {
    if (Error.isError(error) && /^no such table/u.test(error.message))
      return [];
    throw error;
  }
}

// A computed row has its offers, an empty row none, and a failed row its
// error: the computed dataset writes them so.
const offersRow = z.object({
  articleUrl: z.string(),
  offers: z.string().nullable(),
});
const failedRow = z.object({ articleUrl: z.string(), error: z.string() });

// Each program page with its offers, none when the page states no offer that
// its text holds. The key is the page and the kind and value of each offer
// that has a value (money, a percent, months), so a page whose amounts change
// is a new match once. An answer that quotes other words, or that gains or
// loses an offer with no value, such as support, is not.
export class OfferedPrograms implements Condition<SQLTagStore, Alert> {
  async evaluate(sql: SQLTagStore) {
    return rows(
      () =>
        sql.all`SELECT articleUrl, offers FROM program_offers WHERE status IN ('computed', 'empty')`,
    ).map((row) => {
      const { articleUrl, offers } = offersRow.parse(row);
      const stored =
        offers === null ? [] : storedOffersSchema.parse(JSON.parse(offers));
      return {
        key: [articleUrl, ...valuedIdentities(stored).toSorted()].join('\n'),
        data: { kind: 'program' as const, page: articleUrl, offers: stored },
      };
    });
  }
}

// Each page that a model could not read: Jev its kind, or Haiku its
// offers. The key is the step and the page, so a page that fails again at
// each refresh is a match once, until it stops failing.
export class ModelFailures implements Condition<SQLTagStore, Alert> {
  async evaluate(sql: SQLTagStore) {
    const failures = (
      step: 'label' | 'extract',
      read: () => Record<string, unknown>[],
    ) =>
      rows(read).map((row) => {
        const { articleUrl, error } = failedRow.parse(row);
        return {
          key: `${step}\n${articleUrl}`,
          data: {
            kind: 'failed' as const,
            step,
            page: articleUrl,
            reason: error,
          },
        };
      });
    return [
      ...failures(
        'label',
        () =>
          sql.all`SELECT articleUrl, error FROM page_kinds WHERE status = 'failed'`,
      ),
      ...failures(
        'extract',
        () =>
          sql.all`SELECT articleUrl, error FROM program_offers WHERE status = 'failed'`,
      ),
    ];
  }
}
