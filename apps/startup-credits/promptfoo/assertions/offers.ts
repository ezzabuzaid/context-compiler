import {
  type CaseReader,
  F1,
  Gate,
  Grouped,
  Penalized,
  Precision,
  Ratio,
  Recall,
  type Scorer,
  ScorerSet,
} from '@zukhruf/evals';
import { PromptfooAssertion } from '@zukhruf/evals/promptfoo';
import {
  AllMatched,
  ByBestMatch,
  Case,
  type Comparison,
  ComparisonSpec,
  type Item,
  ItemMatches,
  JsonValue,
  type Match,
  PathMatches,
  PerField,
  TokenF1,
  TreeWalk,
  ValueMatches,
} from '@zukhruf/evals/structured';
import { type JsonData, toJsonParseValue } from '@zukhruf/python';
import { z } from 'zod';

import { spanSchema } from '../../src/offer.ts';
import { pageKinds } from '../../src/rules/page-kinds.ts';
import { same } from '../../src/same.ts';
import { lookalikeSchema } from '../dataset/answer-key.ts';

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
// duration are free text, not compared yet. The kind and the lookalikes of
// the page are labels, not stated values: FalseAlarmsByReason reads them.
const sameSentence = new SameSentence();
const offerSpec = new ComparisonSpec({
  arrays: { '$.offers': new ByBestMatch(sameSentence) },
  exclude: [
    '$.kind',
    '$.lookalikes',
    '$.offers[*].quote',
    '$.offers[*].span',
    '$.offers[*].mentions',
    '$.offers[*].who',
    '$.offers[*].duration',
  ],
});

// Why a stated offer is a false alarm, in the order that the reason rule
// asks: an invalid answer has no hits, a page that is not a program states
// no offers, the pairing gives each labelled offer one stated offer, so a
// second offer from a labelled sentence is a duplicate, then the reason of
// the lookalike on its sentence, else a sentence that no label marks.
const reasons = [
  'invalid answer',
  ...pageKinds.flatMap((kind) => (kind === 'program' ? [] : [`${kind} page`])),
  'duplicate',
  ...lookalikeSchema.shape.reason.options,
  'unlabelled',
];
const labelSchema = z.object({
  kind: z.enum(pageKinds),
  lookalikes: z.array(lookalikeSchema),
});

// The case of a page: its label, and why the harness did not answer it, or
// null when it did. The provider decides that, not a schema: it gives an
// invalid answer `invalid` in its metadata, and FailedCall gives a failed
// call `failed`.
class OffersCase extends Case {
  readonly unanswered: string | null;

  constructor(expected: JsonData, unanswered: string | null) {
    super({ expected, weight: 1 });
    this.unanswered = unanswered;
  }
}

function pageOf({ case: page }: Comparison): OffersCase {
  if (page instanceof OffersCase) return page;
  throw new Error('The case of an offers comparison is not an offers page');
}

// Whether the harness answered the page. A page that it did not answer has
// no hits (Penalized), and its expected offers stay in the wholes.
class Answered extends Gate<Comparison> {
  holds(comparison: Comparison): boolean {
    return pageOf(comparison).unanswered === null;
  }

  explain(comparison: Comparison): string {
    return `the harness did not answer: ${pageOf(comparison).unanswered}`;
  }
}
const answered = new Answered();

// The stated offers of one reason, of all stated offers.
type Share = { readonly part: number; readonly whole: number };

// The false alarms of a record by reason: each reason of the closed list,
// also with no false alarm, so the whole of each reason is the whole of
// items precision and the parts add up to that whole minus the hits.
class FalseAlarmsByReason extends Grouped<Comparison, Share> {
  protected *groups(comparison: Comparison): Iterable<[string, Share]> {
    const offers = comparison
      .arrays()
      .find((items) => `${items.field}` === '$.offers');
    if (offers === undefined)
      throw new Error('The expected record of an offers case has no offers');
    const label = labelSchema.parse(toJsonParseValue(comparison.case.expected));
    const expected = [
      ...offers.pairs.map((pair) => pair.expected),
      ...offers.unpairedExpected,
    ];
    // A page that the harness did not answer has no hits, so each offer of
    // its invalid answer is a false alarm.
    const falseAlarms = answered.holds(comparison)
      ? offers.unpairedStated.map(({ value }) =>
          this.#reason(value, label, expected),
        )
      : Array.from({ length: offers.stated }, () => 'invalid answer');
    for (const reason of reasons)
      yield [
        reason,
        {
          part: falseAlarms.filter((other) => other === reason).length,
          whole: offers.stated,
        },
      ];
  }

  #reason(
    offer: JsonData,
    label: z.infer<typeof labelSchema>,
    expected: readonly Item[],
  ): string {
    if (label.kind !== 'program') return `${label.kind} page`;
    if (expected.some(({ value }) => sameSentence.canPair(offer, value)))
      return 'duplicate';
    const { span } = statedOffer.parse(toJsonParseValue(offer));
    return (
      label.lookalikes.find((lookalike) => same(lookalike, span))?.reason ??
      'unlabelled'
    );
  }
}

const share: Scorer<Share> = {
  score: ({ part, whole }) => new Ratio(part, whole),
};

// A support offer has no value: its label writes `value: null`, and the
// harness writes no key. So each scorer reads null as no value.
const values = new ValueMatches({ nullIsMissing: true });
const present = new PathMatches({ nullIsMissing: true });
const items = new ItemMatches();
const penalized = (scorer: Scorer<Comparison>) =>
  new Penalized(scorer, answered);
const words = new TokenF1({
  whenNoWords: 1,
  absentAs: null,
  nullIsMissing: true,
});

const offerScorer = new ScorerSet(
  {
    valid: answered,
    perfect: new AllMatched({ nullIsMissing: true }),
    precision: penalized(new Precision(values)),
    recall: penalized(new Recall(values)),
    f1: penalized(new F1(values)),
    'presence precision': penalized(new Precision(present)),
    'presence recall': penalized(new Recall(present)),
    'presence f1': penalized(new F1(present)),
    'token f1': penalized(words),
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
    'false alarms': new FalseAlarmsByReason(share),
  },
  { comparer: new TreeWalk(offerSpec) },
);

// A case reads its label as ConfigCase does: as a JavaScript value, so an
// integral float such as 7.0 is already 7, and with the weight 1.
const configSchema = z.object({
  expected: z.json(),
  unanswered: z.string().nullable(),
});
const pages: CaseReader<OffersCase> = {
  from(config) {
    const { expected, unanswered } = configSchema.parse(config);
    return new OffersCase(JsonValue.from(expected).value, unanswered);
  },
};

const assertion = new PromptfooAssertion(offerScorer, pages);

// promptfoo gives the assertion the metadata of the provider's response.
const unansweredSchema = z.union([
  z
    .object({ invalid: z.object({ message: z.string() }) })
    .transform(({ invalid }) => invalid.message),
  z.object({ failed: z.string() }).transform(({ failed }) => failed),
]);

// PromptfooAssertion reads its case from the assertion's config, so why the
// harness did not answer goes there beside the label.
export default (
  output: unknown,
  {
    config,
    metadata,
  }: {
    readonly config?: Readonly<Record<string, unknown>>;
    readonly metadata?: unknown;
  },
) => {
  const unanswered = unansweredSchema.safeParse(metadata);
  return assertion.grade(output, {
    config: {
      ...config,
      unanswered: unanswered.success ? unanswered.data : null,
    },
  });
};
