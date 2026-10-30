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
