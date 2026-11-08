import { join } from 'node:path';

import type { TestCase } from 'promptfoo';

import { type Label, answerKey } from './dataset/answer-key.ts';
import { testPages } from './dataset/pages.ts';

type Paths = { readonly answerKey: string; readonly pages: string };

// One row for each test page of the answer key: the page as vars, its kind
// as metadata (for --filter-metadata kind=program), and the assertion of the
// eval, by a file:// reference, not the assertion object: a resumed run reads
// its rows from the stored JSON, which keeps no function. The file has no
// default export: promptfoo looks up :offers or :kinds on a default export
// when there is one.
function rows(
  paths: Paths,
  assertion: string,
  config: (label: Label) => Record<string, unknown>,
): TestCase[] {
  return testPages(answerKey(paths.answerKey), paths.pages).map(
    ({ label, page }) => ({
      description: page.url,
      vars: { url: page.url, title: page.title, text: page.text },
      metadata: { kind: label.kind },
      assert: [
        {
          type: 'javascript',
          value: `file://${join(import.meta.dirname, 'assertions', assertion)}`,
          config: config(label),
        },
      ],
    }),
  );
}

// The offers that each page states. A page that is not a program states no
// offers, so an offer stated on it counts against precision. The kind and
// the lookalikes of the page are not compared: the assertion reads them to
// give the reason of each wrong offer.
export function offers(paths: Paths): TestCase[] {
  return rows(paths, 'offers.ts', (label) => ({
    expected: {
      offers: label.kind === 'program' ? label.offers : [],
      kind: label.kind,
      lookalikes: label.lookalikes,
    },
  }));
}

// The kind of each page.
export function kinds(paths: Paths): TestCase[] {
  return rows(paths, 'page-kinds.ts', (label) => ({ expected: label.kind }));
}
