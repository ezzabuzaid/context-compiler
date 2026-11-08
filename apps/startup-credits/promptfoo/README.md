# The startup-credits evals on promptfoo

The pages and their labels are in `dataset/` (see its README). Each test page is one test.

## Offers

The app reads the offers of each program page with GPT-6-Luna (`ProgramOffers` in `src/rules/program-offers.ts`). promptfoo scores that rule on the test pages:

```sh
npx nx run startup-credits:promptfoo
```

The config is `promptfoo/promptfooconfig.ts`.

The provider calls the real model through the Codex provider of `@deepagents/experimental`. It uses the ChatGPT login of Codex in `CODEX_HOME/auth.json` (by default `~/.codex/auth.json`). `codex login` makes this file. One run makes about 121 model calls, one for each test page, four at a time. On 2026-11-02, one run took about 2 minutes. It used less than 1% of the weekly Codex limit of a Pro plan (the `x-codex-primary-used-percent` header of each answer).

A page that is not a program has no labelled offers. A stated offer and a labelled offer are one offer when the stated span and one mention of the labelled offer share at least half of the shorter span. The pairing gives each labelled offer one stated offer at most. When the call for a page fails, the provider answers `null`. So the labelled offers of that page stay in the wholes of recall.

The assertion (`assertions/offers.ts`) gives these named scores, each pooled over the pages:

- `items recall` and `items precision`: the labelled offers that the rule found, and the stated offers that are a labelled offer.
- `precision`, `recall` and `f1` of the values, and each of them by field, such as `$.offers[*].kind recall by field`.
- `valid`: the pages that the harness answered. The provider decides this: an invalid answer or a failed call is no answer. A page with no answer has no hits, so each offer of its invalid answer is wrong.
- `<reason> false alarms`: the stated offers that are wrong for that reason, of all stated offers. The reasons are, in this order: `invalid answer`; `<kind> page`, for an offer on a page of a kind that is not `program`; `duplicate`, for a second offer from a sentence of a labelled offer; the reason of the lookalike on the sentence of the offer, such as `eligibility`; and `unlabelled`, for a sentence that no label marks. Each reason has the whole of `items precision`, also when it has no false alarms. So the parts of all reasons add up to that whole minus the hits of `items precision`. The false alarms are not in the score of a row.

## Retry

A row whose call failed for the whole run, such as a rejected key, is an error result. Run the error rows of that eval again by its id:

```sh
npx nx run startup-credits:promptfoo-retry --args=<eval id>
```

## Page kinds

The app labels the kind of each page with the `PageKinds` rule (`src/rules/page-kinds.ts`). promptfoo scores that rule on the test pages:

```sh
npx nx run startup-credits:promptfoo-kinds
```

The config is `promptfoo/page-kinds.config.ts`. After the run, its `afterAll` summary writes `apps/startup-credits/results/<eval id>.json`: the accuracy, the macro and weighted averages of the precision, the recall and the F1, the support of each kind and the confusion matrix.

The answer of the rule to a page that sits between two kinds can change from one run to the next. On 2026-10-30 and 2026-10-31, six runs of `typesafe/jev-1.14` (`typesafe/jev-1.14-20261014`) were right on 113, 112, 111, 113, 113 and 113 of 121 pages. Four pages changed kind between runs:

- `stripe.com/atlas` (labelled program): program, home, home, program, home, home.
- `sentry.io/for/startups/` (labelled other): other, other, program, other, other, other.
- `www.figma.com/education/` (labelled other_program): home, home, home, home, other_program, home.
- `www.techstars.com/` (labelled investor): home, home, home, home, home, investor.

Compare rules over more than one run. The answers of the six runs are in Git history: `apps/startup-credits/eval/runs/` at commit `6ffbce3`.
