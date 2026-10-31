import { DatabaseSync, type SQLTagStore } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';

import { getDomain } from 'tldts';
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
    }
  | {
      readonly kind: 'missing';
      // The name that a list gives the program, or null when its links
      // have no text.
      readonly name: string | null;
      readonly links: readonly Claim[];
    };

// A link of a list to a program: the list, the linked page and the text of
// the link.
type Claim = {
  readonly list: string;
  readonly url: string;
  readonly text: string | null;
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

const routeRow = z.object({
  inputUrl: z.string(),
  listingUrl: z.string(),
  url: z.string(),
  how: z.string(),
  text: z.string().nullable(),
});
const kindRow = z.object({
  pageUrl: z.string(),
  articleUrl: z.string(),
  kind: z.string(),
});

// What two links share when they name one program: the registrable domain of
// the page, or the text of the link as a name.
function sharedKeys({ url, text }: Claim) {
  const domain = getDomain(url);
  const name =
    text === null
      ? null
      : `name:${text.toLowerCase().replace(/\s+/gu, ' ').trim()}`;
  return [domain, name].flatMap((key) => (key === null ? [] : [key]));
}

// A claim that shares a key with earlier programs merges them into one, so
// the links of a program do not depend on the order of the claims. Each
// program is named by the first of its members, which `programOfKey` points
// every one of its keys at.
function groupIntoPrograms(claims: readonly Claim[]) {
  const linksOfProgram = new Map<string, Claim[]>();
  const programOfKey = new Map<string, string>();
  for (const claim of claims) {
    const keys = sharedKeys(claim);
    const merged = [
      ...new Set(keys.flatMap((key) => programOfKey.get(key) ?? [])),
    ];
    const program = merged[0] ?? claim.url;
    const links = [
      ...merged.flatMap((member) => linksOfProgram.get(member) ?? []),
      claim,
    ];
    for (const member of merged) linksOfProgram.delete(member);
    linksOfProgram.set(program, links);
    for (const [key, member] of programOfKey)
      if (merged.includes(member)) programOfKey.set(key, program);
    for (const key of keys) programOfKey.set(key, program);
  }
  return [...linksOfProgram.values()];
}

// Each program that the lists name and whose links lead to no page that
// Jev labels program. Two links of the lists name one program when their
// pages share a registrable domain (vercel.com and vercel.com/startups) or
// their texts are the same name ("Anthropic Startup Program" for
// www.anthropic.com in one list and claude.com/programs/startups in the
// other). A program is missing only when Jev has labelled the page of each
// of its links, so a page not read yet is no alarm. The key is the program's
// links, so a list that adds a link to a missing program is a new match.
export class MissingPrograms implements Condition<SQLTagStore, Alert> {
  async evaluate(sql: SQLTagStore) {
    const routes = rows(
      () =>
        sql.all`SELECT inputUrl, listingUrl, url, how, text FROM program_pages_routes`,
    ).map((row) => routeRow.parse(row));
    // A list is read at its own address, or at the one that it redirects
    // to, as a renamed GitHub repository does.
    const lists = new Set(
      routes.flatMap(({ inputUrl, listingUrl, url, how }) =>
        listingUrl === inputUrl && how === 'redirect'
          ? [`${inputUrl} ${url}`]
          : [],
      ),
    );
    const claims: Claim[] = routes.flatMap(
      ({ inputUrl, listingUrl, url, how, text }) =>
        how === 'list-item' &&
        (listingUrl === inputUrl || lists.has(`${inputUrl} ${listingUrl}`))
          ? [{ list: inputUrl, url, text }]
          : [],
    );
    const kinds = new Map<string, string>();
    for (const row of rows(
      () =>
        sql.all`SELECT p.pageUrl, p.articleUrl, k.kind FROM program_pages p JOIN page_kinds k USING (articleUrl) WHERE k.status = 'computed'`,
    )) {
      const { pageUrl, articleUrl, kind } = kindRow.parse(row);
      kinds.set(pageUrl, kind);
      kinds.set(articleUrl, kind);
    }
    const programs = groupIntoPrograms(claims);
    return programs.flatMap((links) => {
      const kindsOfLinks = links.map(({ url }) => kinds.get(url));
      if (kindsOfLinks.includes(undefined)) return [];
      if (kindsOfLinks.includes('program')) return [];
      const sorted = links.toSorted((a, b) => a.url.localeCompare(b.url));
      return [
        {
          key: sorted.map(({ list, url }) => `${list} ${url}`).join('\n'),
          data: {
            kind: 'missing' as const,
            name: links.find(({ text }) => text !== null)?.text ?? null,
            links: sorted,
          },
        },
      ];
    });
  }
}
