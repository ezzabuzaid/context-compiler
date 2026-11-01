import type { SQLTagStore } from 'node:sqlite';

import { ClosedWorld } from '@zukhruf/snapshot-differential';
import { getDomain } from 'tldts';
import { z } from 'zod';

import { Alert, type Change, rows } from './alert.ts';

// A link of a list to a program: the list, the linked page and the text of
// the link.
type Claim = {
  readonly list: string;
  readonly url: string;
  readonly text: string | null;
};

const routeRow = z.object({
  inputUrl: z.string(),
  listingUrl: z.string(),
  url: z.string(),
  how: z.string(),
  text: z.string().nullable(),
});
const crawlRow = z.object({ inputUrl: z.string(), complete: z.number() });
const pageRow = z.object({ pageUrl: z.string(), articleUrl: z.string() });
const failureRow = z.object({ url: z.string() });
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

type MissingProgram = {
  // The name that a list gives the program, or null when its links have no
  // text.
  readonly name: string | null;
  readonly links: readonly Claim[];
};

// Each program that the lists name and whose links lead to no page that
// Jev labels program. Two links of the lists name one program when their
// pages share a registrable domain (vercel.com and vercel.com/startups) or
// their texts are the same name ("Anthropic Startup Program" for
// www.anthropic.com in one list and claude.com/programs/startups in the
// other). A program is missing only when the crawl of each list that links
// it is complete, Jev has labelled each page of its links that the crawl
// stored, and no page of its links failed, so a page or a sitemap not read
// yet, and a page behind a bot challenge, is no alarm. A page that the
// crawl read and stored nothing of, such as one that only a script fills,
// led to no program page. The key is the program's links, so a list that
// adds a link to a missing program logs it again.
export class MissingPrograms extends Alert<MissingProgram> {
  constructor() {
    super({
      name: 'missing programs',
      primaryKey: ['links'],
      key: ({ links }) => [
        links.map(({ list, url }) => `${list} ${url}`).join('\n'),
      ],
      policy: new ClosedWorld(),
    });
  }

  protected records(sql: SQLTagStore) {
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
    const stored = new Set(
      rows(
        () => sql.all`SELECT pageUrl, articleUrl FROM program_pages`,
      ).flatMap((row) => {
        const { pageUrl, articleUrl } = pageRow.parse(row);
        return [pageUrl, articleUrl];
      }),
    );
    const failed = new Set(
      rows(() => sql.all`SELECT url FROM program_pages_failures`).map(
        (row) => failureRow.parse(row).url,
      ),
    );
    const next = Map.groupBy(routes, ({ listingUrl }) => listingUrl);
    // The page that a link lands on: the crawl hands a redirected page back
    // at its target, so a link has the label of the page its redirects
    // reach.
    const redirects = new Map(
      routes.flatMap(({ listingUrl, url, how }) =>
        how === 'redirect' ? [[listingUrl, url] as const] : [],
      ),
    );
    const landed = (url: string) => {
      const seen = new Set([url]);
      let at = url;
      for (
        let target = redirects.get(at);
        target !== undefined && !seen.has(target);
        target = redirects.get(at)
      ) {
        seen.add(target);
        at = target;
      }
      return at;
    };
    // The pages that the routes from a linked page lead to, the page itself
    // first: its links and its sitemaps, when the crawl searched its site.
    const reached = (url: string) => {
      const seen = new Set([url]);
      for (const at of seen)
        for (const route of next.get(at) ?? []) seen.add(route.url);
      return seen;
    };
    // The lists whose last crawl is complete: SQLite stores the boolean as
    // 1 or 0.
    const complete = new Set(
      rows(
        () => sql.all`SELECT inputUrl, complete FROM program_pages_crawls`,
      ).flatMap((row) => {
        const { inputUrl, complete } = crawlRow.parse(row);
        return complete === 1 ? [inputUrl] : [];
      }),
    );
    const programs = groupIntoPrograms(claims);
    return programs.flatMap((links) => {
      if (links.some(({ list }) => !complete.has(list))) return [];
      // A failed page, or a stored page not labelled yet, can still be a
      // program page.
      if (
        links.some(({ url }) => {
          const page = landed(url);
          return failed.has(page) || (stored.has(page) && !kinds.has(page));
        })
      )
        return [];
      // A program page counts only on a website of the program's own links:
      // a partner's program that a home page links is not this program.
      const domains = new Set(links.map(({ url }) => getDomain(url)));
      const found = links.some(({ url }) =>
        [...reached(url)].some(
          (page) =>
            kinds.get(page) === 'program' && domains.has(getDomain(page)),
        ),
      );
      if (found) return [];
      return [
        {
          name: links.find(({ text }) => text !== null)?.text ?? null,
          links: links.toSorted((a, b) => a.url.localeCompare(b.url)),
        },
      ];
    });
  }

  protected line({ type, record: { name, links } }: Change<MissingProgram>) {
    if (type === 'update') return null;
    const linked = links
      .map(({ url, list }) => `${url} linked by ${list}`)
      .join('; ');
    return name === null
      ? `no program page found (${linked})`
      : `${name}: no program page found (${linked})`;
  }
}
