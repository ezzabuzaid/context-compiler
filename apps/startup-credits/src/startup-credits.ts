import { join } from 'node:path';
import type { SQLTagStore } from 'node:sqlite';

import { Eca } from '@workspace/eca';
import { Connection, Copy, Pipeline } from '@workspace/elt';
import {
  ComputedDataset,
  SQLiteCheckpointStore,
  SQLiteDestination,
  SQLiteSyncHistory,
} from '@workspace/elt-sqlite';
import {
  AdaptiveRevisit,
  CompositeRevisit,
  CrawlError,
  FixedRevisit,
  PaginationReader,
  hour,
} from '@workspace/sdk-web-crawler';
import { ArticleExtractor } from '@workspace/source-web-pages/article-extractor';
import { WebSource } from '@workspace/source-web-pages/web-source';
import { WebStream } from '@workspace/source-web-pages/web-stream';

import {
  type Alert,
  CreditsWarehouse,
  MissingPrograms,
  ProgramAmounts,
} from './alerts.ts';
import { type Amounts, CreditAmounts } from './credit-amounts.ts';

// The crawler's name, which robots.txt groups match (RFC 9309).
const userAgent =
  'StartupCredits/0.1 (+https://github.com/ezzabuzaid/context-compiler)';

const amountsOf = (amounts: Amounts) =>
  amounts.map(({ amount }) => amount).join(', ');

const reasonOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

const unreadableLine = (reason: unknown) =>
  reason instanceof CrawlError
    ? `could not read ${reason.url}: ${reasonOf(reason.cause)}`
    : `could not read: ${reasonOf(reason)}`;

// Reads the lists of startup credit programs and each page they link on
// another website, keeps the credit amounts of each page, and logs a line
// for each program that appears, each change of its amounts, each linked page
// with no amount, and each page the crawl could not read, until the signal
// stops it. Lists are read every hour, and pages when they change, as
// AdaptiveRevisit learns.
export async function watchStartupCredits({
  lists,
  directory,
  log,
  signal,
}: {
  readonly lists: readonly string[];
  readonly directory: string;
  readonly log: (line: string) => void;
  readonly signal: AbortSignal;
}): Promise<void> {
  const path = join(directory, 'credits.sqlite');
  const destination = new SQLiteDestination({ path });
  // Every host but the lists' own, so a list's license and commits are not
  // pages (the crawler recipe "Follow a list to other websites").
  const listHosts = [...new Set(lists.map((list) => new URL(list).hostname))];
  const source = new WebSource({
    stream: new WebStream({
      name: 'program_pages',
      primaryKey: ['articleUrl'],
      readers: [new PaginationReader({ strategy: 'all' })],
      revisit: new CompositeRevisit(
        lists.map((list) => [
          new URLPattern(list),
          new FixedRevisit({ every: hour }),
        ]),
        new AdaptiveRevisit(),
      ),
      include: [
        new URLPattern({
          hostname: `((?!(?:${listHosts.map((host) => host.replaceAll('.', '\\.')).join('|')})$).*)`,
        }),
      ],
      extractor: new ArticleExtractor(),
    }),
    inputs: lists,
    userAgent,
    cachePath: join(directory, 'web-http.sqlite'),
  });
  const pages = destination.table('program_pages');
  const pipeline = new Pipeline({
    // One process runs the passes, so a pass left running belongs to one
    // that stopped.
    history: new SQLiteSyncHistory({ soleWriter: true }),
    connections: [
      new Connection({
        name: 'lists',
        source,
        destination,
        checkpoints: new SQLiteCheckpointStore({
          path: join(directory, 'checkpoints.sqlite'),
        }),
        steps: [
          new Copy((await source.discover()).get('program_pages'), pages, {
            id: 'lists:program_pages',
            syncMode: 'incremental',
            destinationSyncMode: 'append_dedup',
          }),
        ],
      }),
    ],
    derived: [
      new ComputedDataset({
        into: destination,
        name: 'credit_amounts',
        description: 'The credit amounts that each program page states.',
        from: [pages],
        compute: new CreditAmounts(),
      }),
    ],
  });

  using warehouse = new CreditsWarehouse(path);
  const eca = new Eca<SQLTagStore, Alert>({ warehouse });
  const programs = { condition: new ProgramAmounts() };
  // What the app saw before this start is its baseline: a restart logs only
  // what changes after it.
  await eca.add(programs);
  await eca.add({ condition: new MissingPrograms() });
  const known = new Map<string, Amounts>();
  for (const { data } of await programs.condition.evaluate(warehouse.sql))
    if (data.kind === 'program') known.set(data.page, data.amounts);

  // Either loop that fails stops the other.
  const failed = new AbortController();
  const watching = AbortSignal.any([signal, failed.signal]);
  await Promise.all([
    (async () => {
      for await (const { outcomes } of pipeline.watch({ signal: watching }))
        for (const { failures, cancelled } of outcomes) {
          // A pass that the stop ended is cancelled, not failed.
          if (cancelled) continue;
          for (const { error } of failures)
            for (const reason of error instanceof AggregateError
              ? error.errors
              : [error])
              log(unreadableLine(reason));
        }
    })().catch((error: unknown) => failed.abort(error)),
    (async () => {
      for await (const item of eca.watch({ signal: watching })) {
        // A condition that threw keeps its keys and runs again at the next
        // commit, so it loses nothing.
        if ('error' in item) {
          log(`could not check: ${reasonOf(item.error)}`);
          continue;
        }
        const { data } = item;
        if (data.kind === 'missing')
          log(`no program page found ${data.page} (linked by ${data.list})`);
        else {
          const before = known.get(data.page);
          known.set(data.page, data.amounts);
          log(
            before === undefined
              ? `new program ${data.page}: ${data.amounts.map(({ amount, sentence }) => `${amount} ("${sentence}")`).join('; ')}`
              : `amount changed ${data.page}: ${amountsOf(before)} → ${amountsOf(data.amounts)}`,
          );
        }
      }
    })().catch((error: unknown) => failed.abort(error)),
  ]);
  if (failed.signal.aborted && !signal.aborted) throw failed.signal.reason;
}
