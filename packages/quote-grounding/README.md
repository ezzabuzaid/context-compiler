# @workspace/quote-grounding

A language model that reads a text gives a quote as the evidence for its answer. A model can write a quote that is not in the text. `ground` finds where the quote is in the text, so an app keeps an answer only when its quote is really there.

```ts
import { type Span, ground } from '@workspace/quote-grounding';

const span: Span | null = ground(page, answer.quote);
```

`ground(text, quote)` gives the span of the quote in `text`, in UTF-16 offsets with the end excluded, or `null` when the text does not have the quote. It ignores:

- the case of letters: a page writes its headings in capitals;
- the kind and the number of white-space characters: many pages use non-breaking spaces, and a model writes a line break as a space.

A quote that has only white space is in no text. The span is in the original text, so `text.slice(span.start, span.end)` gives the words as the text writes them.

## Why not a package from npm

The problem is text-quote anchoring, as the W3C Web Annotation `TextQuoteSelector` describes it. On 2026-11-03 no package on npm did this job. Each one fails to ignore case and white space while it gives offsets in the original text:

| Package                            | Why it does not do the job                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@apache-annotator/selector` 0.2.0 | Its match is sensitive to white space and case (a plain `indexOf`); no release since 2022.                                                  |
| `dom-anchor-text-quote` 4.0.2      | Needs a DOM node; fuzzy; no release since 2017.                                                                                             |
| `approx-string-match` 2.0.1        | Edit distance: each white-space or case difference is an error, so a long quote with many line breaks fails or a different passage matches. |
| `diff-match-patch` and its forks   | Fuzzy Bitap with a limit of 32 characters; gives only a start.                                                                              |
| `fuse.js` 7.5.0                    | Ignores case only; fuzzy, so it can accept a quote that is not in the text; offsets refer to the lower-case text.                           |
| `text-quote-selector` 1.1.2        | Needs DOM nodes.                                                                                                                            |
