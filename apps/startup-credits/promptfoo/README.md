# The startup-credits evals on promptfoo

The pages and their labels are in `dataset/` (see its README). Each test page is one test.

## Offers

The app reads the offers of each program page with GPT-6-Luna (`ProgramOffers` in `src/rules/program-offers.ts`). promptfoo scores that rule on the test pages:

```sh
npx nx run startup-credits:promptfoo
```

The config is `promptfoo/promptfooconfig.ts`.

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
