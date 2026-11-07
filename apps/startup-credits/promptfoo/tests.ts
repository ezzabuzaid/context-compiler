import { join } from 'node:path';

import type { TestCase } from 'promptfoo';

import { answerKey } from '../eval/answer-key.ts';
import { testPages } from '../eval/pages.ts';

// One row for each test page of the answer key: the page as vars, its kind
// as metadata (for --filter-metadata kind=program), and the offers that it
// states as the config of its offers assertion. A page that is not a program
// states no offers, so an offer stated on it counts against precision. The
// file has no default export: promptfoo looks up :load on a default export
// when there is one.
export function load(config: {
  readonly answerKey: string;
  readonly pages: string;
}): TestCase[] {
  return testPages(answerKey(config.answerKey), config.pages).map(
    ({ label, page }) => ({
      description: page.url,
      vars: { url: page.url, title: page.title, text: page.text },
      metadata: { kind: label.kind },
      // A file:// reference, not the assertion object: a resumed run reads
      // its rows from the stored JSON, which keeps no function.
      assert: [
        {
          type: 'javascript',
          value: `file://${join(import.meta.dirname, 'assertions', 'offers.ts')}`,
          config: {
            expected: {
              offers: label.kind === 'program' ? label.offers : [],
            },
          },
        },
      ],
    }),
  );
}
