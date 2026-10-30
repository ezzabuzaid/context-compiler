import { DatabaseSync, type SQLTagStore } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';

import type { Condition, Warehouse } from '@workspace/eca';

import { type Amounts, amountsSchema } from './credit-amounts.ts';

// The app's SQLite file as eca's warehouse, read only. A commit is any change
// another connection commits there, the copies' and the amount rule's, which
// PRAGMA data_version shows; SQLite tells a reader nothing, so it asks every
// second. The watch refreshes the amounts after a pass, not before it yields
// the pass, so a commit of the pass alone would read the amounts before it.
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
      readonly amounts: Amounts;
    }
  | { readonly kind: 'missing'; readonly page: string; readonly list: string };

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

// Each program page with its credit amounts. The key is the page and its
// amounts together, so a page that gains amounts, or whose amounts change,
// is a new match once.
export class ProgramAmounts implements Condition<SQLTagStore, Alert> {
  async evaluate(sql: SQLTagStore) {
    return rows(
      () =>
        sql.all`SELECT articleUrl, amounts FROM credit_amounts WHERE status = 'computed'`,
    ).flatMap(({ articleUrl, amounts }) =>
      typeof articleUrl === 'string' && typeof amounts === 'string'
        ? [
            {
              key: `${articleUrl}\n${amounts}`,
              data: {
                kind: 'program' as const,
                page: articleUrl,
                amounts: amountsSchema.parse(JSON.parse(amounts)),
              },
            },
          ]
        : [],
    );
  }
}

// Each page that a list links and that states no credit amount, such as a
// company's home page: the program page is somewhere else on its site.
export class MissingPrograms implements Condition<SQLTagStore, Alert> {
  async evaluate(sql: SQLTagStore) {
    return rows(
      () =>
        sql.all`SELECT c.articleUrl, min(p.listingUrl) AS listingUrl FROM credit_amounts c JOIN program_pages p ON p.articleUrl = c.articleUrl WHERE c.status = 'empty' GROUP BY c.articleUrl`,
    ).flatMap(({ articleUrl, listingUrl }) =>
      typeof articleUrl === 'string' && typeof listingUrl === 'string'
        ? [
            {
              key: articleUrl,
              data: {
                kind: 'missing' as const,
                page: articleUrl,
                list: listingUrl,
              },
            },
          ]
        : [],
    );
  }
}
