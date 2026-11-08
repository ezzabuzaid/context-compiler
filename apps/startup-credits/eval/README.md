# Evaluation of the page labels and the offer extraction

The app reads the pages that GitHub lists of startup programs link. A model labels the kind of each page, and an extractor states the offers of each program page. This folder scores those two jobs against labels that a person or an agent wrote by hand. Run it before you change a prompt, a model, a worked example or a step of the extraction, and run it again after the change. It is not in the app's build.

## Cache

The repository keeps no publisher text. `cache/pages.json` (Git ignores it) holds the frozen pages of one live run: the URL, the title, the list that linked it, the load time, the text and the sha256 of the text. One article URL is one page, also when two lists link it.

Freeze the pages of the app's last run:

```sh
npx nx run startup-credits:eval-seed
```

The labels in `answer-key.json` name the run (`run`, its `loaded_at` time) and the sha256 of each page's text. The scorer stops when the cache holds other text than the labels. Then seed from that run again, or label the new run.

## Labels

`answer-key.json` has one entry for each page:

- `kind`: `program`, `home`, `list`, `article`, `other_program`, `investor` or `other`.
- `offers` (program pages only): each thing that the program gives startups. Its `kind` is `credits`, `discount`, `free_period`, `support` or `perks`. Its `value` is the largest amount and its currency, or `null`. It also has `percent`, `duration`, `who`, and `mentions`: every span of the text that states the offer.
- `lookalikes` (program pages only): spans that look like offers but are not, with a reason such as `eligibility` or `testimonial`.
- `role`: `test`, or `example` for a page that an extractor shows as a worked example. The scorer leaves out the example pages.

`frozenAt` is the time when the labels were frozen. No design was scored on the labels before that time.

## Score

Write the answers of an extractor to a JSON file:

```json
{
  "extractor": "v3 LangExtract-style, LFM3-1.7B",
  "pages": [
    {
      "url": "https://vercel.com/startups",
      "kind": "program",
      "offers": [
        {
          "kind": "credits",
          "value": { "amount": 30000, "currency": "USD" },
          "span": { "start": 1701, "end": 1830 }
        }
      ]
    }
  ]
}
```

An offer gives its `span` in the page text, or a `quote` that the scorer finds in the text. `kind` on the page is optional. Then:

```sh
npx nx run startup-credits:eval -- answers.json
```

A predicted offer matches a labelled offer when its span and one of the offer's mentions share at least half of the shorter span. The scorer counts:

- the offers found (recall), and found with the right kind;
- the wrong offers (precision), by reason: a look-alike, an unlabelled sentence, an unaligned quote, or an offer on a page that is not a program;
- the duplicates, which are a second match of one offer;
- the exact amounts;
- the page kinds that are right, and each confusion.

## Offer extraction

The app reads the offers of each program page with GPT-6-Luna (`ProgramOffers` in `src/rules/program-offers.ts`). `eval-predict` runs that same rule on each test page of the cache and writes its answers in the format of `eval`:

```sh
npx nx run startup-credits:eval-predict -- answers.json
npx nx run startup-credits:eval -- answers.json
```

It calls the real model through the Codex provider of `@deepagents/experimental`. The provider uses the ChatGPT login of Codex in `CODEX_HOME/auth.json` (by default `~/.codex/auth.json`), which `codex login` makes. One run makes about 121 model calls, one for each test page, four at a time. On 2026-11-02, one run took about 2 minutes and used less than 1% of a Pro plan's weekly Codex limit (the `x-codex-primary-used-percent` header of each answer).

The extractor name in the file is the model and the first 12 characters of the hash in the rule identity. A page that the rule failed on is in the file with its error and no offers, and the run writes the error to stderr.

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
