import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { pageKinds } from '../src/page-kinds.ts';
import { type Label, type Span, answerKey, offerKinds } from './answer-key.ts';
import { ground } from './ground.ts';
import { scoreKinds } from './kind-score.ts';
import { pages } from './pages.ts';

// What an extractor answered for each page it read: its offers, each with
// the span it was grounded to or the quote it gave, and the page kind when
// the extractor also labels pages.
const predictionsSchema = z.object({
  extractor: z.string(),
  pages: z.array(
    z.object({
      url: z.string(),
      kind: z.enum(pageKinds).optional(),
      offers: z.array(
        z.object({
          kind: z.enum(offerKinds),
          value: z
            .object({ amount: z.number(), currency: z.string() })
            .nullable(),
          span: z
            .object({ start: z.number().int(), end: z.number().int() })
            .nullable()
            .optional(),
          quote: z.string().optional(),
        }),
      ),
    }),
  ),
});
type Prediction = z.infer<typeof predictionsSchema>['pages'][number];

const overlap = (a: Span, b: Span) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

// Two spans state the same thing when they share at least half of the
// shorter one, so a prediction that quotes a sentence without its heading,
// or with it, still matches the labelled mention.
const same = (a: Span, b: Span) =>
  overlap(a, b) * 2 >= Math.min(a.end - a.start, b.end - b.start);

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

type Tally = {
  labelled: number;
  found: number;
  kindRight: number;
  duplicates: number;
  wrong: Map<string, number>;
  amounts: number;
  amountsRight: number;
};

function wrongReason(label: Label, span: Span) {
  if (label.kind !== 'program') return `${label.kind} page`;
  const lookalike = label.lookalikes.find((candidate) => same(candidate, span));
  return lookalike?.reason ?? 'unlabelled';
}

function scorePage(
  label: Label,
  text: string,
  prediction: Prediction,
  tally: Tally,
) {
  const offers = label.kind === 'program' ? label.offers : [];
  tally.labelled += offers.length;
  tally.amounts += offers.filter(({ value }) => value !== null).length;
  const matched = new Set<number>();
  for (const predicted of prediction.offers) {
    const span = predicted.span ?? ground(text, predicted.quote);
    if (span === null) {
      increment(tally.wrong, 'unaligned');
      continue;
    }
    // One sentence can state two offers, such as credits and support, so a
    // prediction takes the unmatched offer of its own kind first.
    const candidates = offers.flatMap((offer, index) =>
      offer.mentions.some((mention) => same(mention, span)) ? [index] : [],
    );
    const unmatched = candidates.filter((index) => !matched.has(index));
    const index =
      unmatched.find((index) => offers[index]!.kind === predicted.kind) ??
      unmatched[0] ??
      candidates[0] ??
      -1;
    if (index === -1) {
      increment(tally.wrong, wrongReason(label, span));
      continue;
    }
    if (matched.has(index)) {
      tally.duplicates++;
      continue;
    }
    matched.add(index);
    const offer = offers[index]!;
    tally.found++;
    if (offer.kind === predicted.kind) tally.kindRight++;
    if (
      offer.value !== null &&
      predicted.value?.amount === offer.value.amount &&
      predicted.value.currency === offer.value.currency
    )
      tally.amountsRight++;
  }
}

const key = answerKey();
const texts = pages();
const predictions = predictionsSchema.parse(
  JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')),
);
const answered = new Map(predictions.pages.map((page) => [page.url, page]));
const tally: Tally = {
  labelled: 0,
  found: 0,
  kindRight: 0,
  duplicates: 0,
  wrong: new Map(),
  amounts: 0,
  amountsRight: 0,
};
const tests = key.pages.filter(({ role }) => role === 'test');
for (const label of tests) {
  const prediction = answered.get(label.url);
  const page = texts.get(label.url);
  if (prediction === undefined || page === undefined) continue;
  if (page.sha256 !== label.sha256)
    throw new Error(`${label.url}: the cache holds other text than the labels`);
  scorePage(label, page.text, prediction, tally);
}
const kinds = scoreKinds(
  key.pages,
  new Map(
    predictions.pages.flatMap(({ url, kind }) =>
      kind === undefined ? [] : [[url, kind]],
    ),
  ),
);

const wrong = [...tally.wrong.values()].reduce((sum, count) => sum + count, 0);
const percent = (part: number, whole: number) =>
  whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`;
console.log(
  `extractor: ${predictions.extractor}; answered ${tests.filter(({ url }) => answered.has(url)).length} of ${tests.length} test pages`,
);
console.log(
  `offers found ${tally.found}/${tally.labelled} (recall ${percent(tally.found, tally.labelled)}), right kind ${tally.kindRight}`,
);
console.log(
  `wrong ${wrong} (precision ${percent(tally.found, tally.found + wrong)}): ${[...tally.wrong].map(([reason, count]) => `${reason} ${count}`).join(', ')}`,
);
console.log(`duplicates ${tally.duplicates}`);
console.log(`amounts right ${tally.amountsRight}/${tally.amounts}`);
if (kinds.pages > 0)
  console.log(
    `page kinds right ${kinds.right}/${kinds.pages} (${percent(kinds.right, kinds.pages)}): ${[...kinds.confusions].map(([confusion, count]) => `${confusion} ${count}`).join(', ')}`,
  );
