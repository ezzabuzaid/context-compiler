# The old offer scorer

`score.ts` and `predict.ts` are the scorer and the runner of the offer extraction from before the promptfoo evals (`../promptfoo/`). They read the labelled pages in `../promptfoo/dataset/` (see its README). They stay until promptfoo gives the wrong offers by reason, and they go in that change (backlog #3882).

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
