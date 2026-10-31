import { writeFileSync } from 'node:fs';

import { z } from 'zod';

import { storedOffersSchema } from '../src/offer.ts';
import { ProgramOffers } from '../src/program-offers.ts';
import { answerKey } from './answer-key.ts';
import { pages } from './pages.ts';

// Runs the app's own offer rule on each test page of the cache and writes
// its offers in the format of score.ts to the file that the first argument
// names. A page that the rule failed on is in the file with its error and no
// offers.
const file = process.argv[2];
if (file === undefined) throw new Error('Give the file to write the offers to');

const stop = new AbortController();
process.once('SIGINT', () => stop.abort());

const rule = new ProgramOffers();
const identity = await rule.identity();
const texts = pages();
const tests = answerKey().pages.filter(({ role }) => role === 'test');

type Predicted = {
  url: string;
  offers: Record<string, unknown>[];
  error?: string;
};
const predicted: Predicted[] = [];
// As many calls at once as the app makes, each taking the next page from
// one shared iterator.
const queue = tests.values();
await Promise.all(
  Array.from({ length: rule.concurrency }, async () => {
    for (const label of queue) {
      const page = texts.get(label.url);
      if (page?.sha256 !== label.sha256)
        throw new Error(
          `${label.url}: the cache holds other text than the labels`,
        );
      const [result] = await rule.compute(
        [{ url: page.url, title: page.title, text: page.text }],
        stop.signal,
      );
      if (result === undefined || 'gone' in result)
        throw new Error(`${page.url}: the rule gave no output`);
      if ('error' in result) {
        console.error(`could not extract ${page.url}: ${result.error}`);
        predicted.push({ url: page.url, offers: [], error: result.error });
      } else if ('empty' in result)
        predicted.push({ url: page.url, offers: [] });
      else
        predicted.push({
          url: page.url,
          // The scorer reads value as money or null; a discount, a free
          // period and support have no money.
          offers: storedOffersSchema
            .parse(JSON.parse(z.string().parse(result.value.offers)))
            .map((offer) => ({
              ...offer,
              value: 'value' in offer ? offer.value : null,
            })),
        });
    }
  }),
);

const separator = identity.indexOf(':');
writeFileSync(
  file,
  JSON.stringify(
    {
      extractor: `ProgramOffers ${identity.slice(0, separator)} ${identity.slice(separator + 1, separator + 13)}`,
      pages: predicted.toSorted((a, b) => a.url.localeCompare(b.url)),
    },
    null,
    1,
  ),
);
console.log(
  `${predicted.length} pages, ${predicted.filter(({ error }) => error !== undefined).length} failed: ${file}`,
);
