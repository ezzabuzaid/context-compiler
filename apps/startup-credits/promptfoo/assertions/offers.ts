import {
  ByBestMatch,
  type Match,
  RecordCase,
  RecordSchema,
  RecordScorer,
  RecordSpec,
} from '@zukhruf/structured-eval';
import { PromptfooAssertion } from '@zukhruf/structured-eval/promptfoo';
import { z } from 'zod';

import { spanSchema, storedOffersSchema } from '../../src/offer.ts';
import { same } from '../../src/same.ts';

const statedOffer = z.object({ span: spanSchema });
const expectedOffer = z.object({ mentions: z.array(spanSchema) });

// A stated offer and a labelled offer are one offer when the stated quote
// and a sentence that the label marks share at least half of the shorter
// span, the rule of src/same.ts.
class SameSentence implements Match {
  canPair(stated: unknown, expected: unknown): boolean {
    const statedSpan = statedOffer.safeParse(stated);
    const expectedMentions = expectedOffer.safeParse(expected);
    return (
      statedSpan.success &&
      expectedMentions.success &&
      expectedMentions.data.mentions.some((mention) =>
        same(statedSpan.data.span, mention),
      )
    );
  }
}

// The schema is that of the offers that the harness stores, each with the
// span of its quote. The quote and its span are publisher text and its
// position; who and duration are free text, not compared yet.
const offerSpec = new RecordSpec({
  schema: new RecordSchema(
    z.toJSONSchema(z.object({ offers: storedOffersSchema })),
  ),
  arrays: { offers: new ByBestMatch(new SameSentence()) },
  ignore: [
    'offers[].quote',
    'offers[].span',
    'offers[].mentions',
    'offers[].who',
    'offers[].duration',
  ],
});

export default new PromptfooAssertion(new RecordScorer(offerSpec), RecordCase)
  .grade;
