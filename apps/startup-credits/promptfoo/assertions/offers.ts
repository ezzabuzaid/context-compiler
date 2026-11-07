import { F1, Penalized, Precision, Recall, type Scorer } from '@zukhruf/evals';
import { PromptfooAssertion } from '@zukhruf/evals/promptfoo';
import {
  AllMatched,
  ByBestMatch,
  type Comparison,
  ComparisonSpec,
  ConfigCase,
  ItemMatches,
  JsonSchema,
  JsonValue,
  type Match,
  PathMatches,
  PerField,
  SchemaCompliance,
  ScorerSet,
  TokenF1,
  TypePrecision,
  ValueMatches,
} from '@zukhruf/evals/structured';
import { type JsonData, toJsonParseValue } from '@zukhruf/python';
import { z } from 'zod';

import { spanSchema, storedOffersSchema } from '../../src/offer.ts';
import { same } from '../../src/same.ts';

const statedOffer = z.object({ span: spanSchema });
const expectedOffer = z.object({ mentions: z.array(spanSchema) });

// A stated offer and a labelled offer are one offer when the stated quote
// and a sentence that the label marks share at least half of the shorter
// span, the rule of src/same.ts. The walk gives JSON data, whose objects are
// Maps, so zod reads them as JSON.parse would give them.
class SameSentence implements Match {
  canPair(stated: JsonData, expected: JsonData): boolean {
    const statedSpan = statedOffer.safeParse(toJsonParseValue(stated));
    const expectedMentions = expectedOffer.safeParse(
      toJsonParseValue(expected),
    );
    return (
      statedSpan.success &&
      expectedMentions.success &&
      expectedMentions.data.mentions.some((mention) =>
        same(statedSpan.data.span, mention),
      )
    );
  }
}

// The quote and its span are publisher text and its position; who and
// duration are free text, not compared yet.
const offerSpec = new ComparisonSpec({
  arrays: { '$.offers': new ByBestMatch(new SameSentence()) },
  exclude: [
    '$.offers[*].quote',
    '$.offers[*].span',
    '$.offers[*].mentions',
    '$.offers[*].who',
    '$.offers[*].duration',
  ],
});

// A support offer has no value: its label writes `value: null`, and the
// harness writes no key. So each scorer reads null as no value.
const valid = new SchemaCompliance();
const values = new ValueMatches({ nullIsMissing: true });
const present = new PathMatches({ nullIsMissing: true });
const items = new ItemMatches();
// An invalid record keeps its expected and its stated values in the wholes,
// with no hits.
const penalized = (scorer: Scorer<Comparison>) => new Penalized(scorer, valid);
const words = new TokenF1({
  whenNoWords: 1,
  absentAs: null,
  nullIsMissing: true,
});

const offerScorer = new ScorerSet(
  {
    valid,
    perfect: new AllMatched({ nullIsMissing: true }),
    precision: penalized(new Precision(values)),
    recall: penalized(new Recall(values)),
    f1: penalized(new F1(values)),
    'presence precision': penalized(new Precision(present)),
    'presence recall': penalized(new Recall(present)),
    'presence f1': penalized(new F1(present)),
    'token f1': penalized(words),
    'type precision': new TypePrecision({ nullIsMissing: true }),
    'items precision': penalized(new Precision(items)),
    'items recall': penalized(new Recall(items)),
    'items f1': penalized(new F1(items)),
    'precision by field': new PerField(penalized(new Precision(values))),
    'recall by field': new PerField(penalized(new Recall(values))),
    'f1 by field': new PerField(penalized(new F1(values))),
    'presence precision by field': new PerField(
      penalized(new Precision(present)),
    ),
    'presence recall by field': new PerField(penalized(new Recall(present))),
    'presence f1 by field': new PerField(penalized(new F1(present))),
    'token f1 by field': new PerField(penalized(words)),
  },
  { spec: offerSpec },
);

// The schema is that of the offers that the harness stores, each with the
// span of its quote.
export default new PromptfooAssertion(
  offerScorer,
  new ConfigCase({
    schema: new JsonSchema(
      JsonValue.from(z.toJSONSchema(z.object({ offers: storedOffersSchema }))),
    ),
  }),
).grade;
