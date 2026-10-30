import { join } from 'node:path';
import type { SQLTagStore } from 'node:sqlite';

import { Eca } from '@workspace/eca';
import { CrawlError } from '@workspace/sdk-web-crawler';

import {
  type Alert,
  CreditsWarehouse,
  MissingPrograms,
  ProgramAmounts,
} from './alerts.ts';
import type { Amounts } from './credit-amounts.ts';
import directory from './directory.ts';
import pipeline from './pipeline.ts';

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => stop.abort());

const amountsOf = (amounts: Amounts) =>
  amounts.map(({ amount }) => amount).join(', ');

const reasonOf = (error: unknown) =>
  Error.isError(error) ? error.message : String(error);

using warehouse = new CreditsWarehouse(join(directory, 'credits.sqlite'));
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
const watching = AbortSignal.any([stop.signal, failed.signal]);
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
            console.log(
              reason instanceof CrawlError
                ? `could not read ${reason.url}: ${reasonOf(reason.cause)}`
                : `could not read: ${reasonOf(reason)}`,
            );
      }
  })().catch((error: unknown) => failed.abort(error)),
  (async () => {
    for await (const item of eca.watch({ signal: watching })) {
      // A condition that threw keeps its keys and runs again at the next
      // commit, so it loses nothing.
      if ('error' in item) {
        console.log(`could not check: ${reasonOf(item.error)}`);
        continue;
      }
      const { data } = item;
      if (data.kind === 'missing')
        console.log(
          `no program page found ${data.page} (linked by ${data.list})`,
        );
      else {
        const before = known.get(data.page);
        known.set(data.page, data.amounts);
        console.log(
          before === undefined
            ? `new program ${data.page}: ${data.amounts.map(({ amount, sentence }) => `${amount} ("${sentence}")`).join('; ')}`
            : `amount changed ${data.page}: ${amountsOf(before)} → ${amountsOf(data.amounts)}`,
        );
      }
    }
  })().catch((error: unknown) => failed.abort(error)),
]);
if (failed.signal.aborted && !stop.signal.aborted) throw failed.signal.reason;
