# The labelled pages

The startup-credits evals score two jobs of the app against the pages in this folder: the kind of each page, and the offers of each program page. A person or an agent wrote the labels by hand. The promptfoo configs in the folder above read them: `promptfooconfig.ts` for the offers, `page-kinds.config.ts` for the page kinds.

## Cache

The repository keeps no publisher text. `cache/pages.json` (Git ignores it) holds the frozen pages of one live run: the URL, the title, the list that linked it, the load time, the text and the sha256 of the text. One article URL is one page, also when two lists link it.

Freeze the pages of the app's last run:

```sh
npx nx run startup-credits:eval-seed
```

The labels in `answer-key.json` name the run (`run`, its `loaded_at` time) and the sha256 of each page's text. The evals stop when the cache holds other text than the labels (`testPages` in `pages.ts`). Then seed from that run again, or label the new run.

## Labels

`answer-key.json` has one entry for each page:

- `kind`: `program`, `home`, `list`, `article`, `other_program`, `investor` or `other`.
- `offers` (program pages only): each thing that the program gives startups. Its `kind` is `credits`, `discount`, `free_period`, `support` or `perks`. Its `value` is the largest amount and its currency, or `null`. It also has `percent`, `duration`, `who`, and `mentions`: every span of the text that states the offer.
- `lookalikes` (program pages only): spans that look like offers but are not, with a reason such as `eligibility` or `testimonial`.
- `role`: `test`, or `example` for a page that an extractor shows as a worked example. The evals leave out the example pages.

`frozenAt` is the time when the labels were frozen. No design was scored on the labels before that time.
