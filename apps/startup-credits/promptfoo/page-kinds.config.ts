import { join } from 'node:path';

import type { UnifiedConfig } from 'promptfoo';

import { PageKinds } from '../src/rules/page-kinds.ts';
import { answerKeyFile } from './dataset/answer-key.ts';
import { cache } from './dataset/pages.ts';

// The paths are absolute, so a config that spreads this one from another
// folder, as the eval's test does with its own answer key and cache, names
// the same provider, generator and summary.
export default {
  description: "The kind that the app's PageKinds rule gives each test page",
  // The input of the harness is the page to read.
  prompts: ['{{url}}'],
  providers: [
    {
      id: `file://${join(import.meta.dirname, 'providers', 'page-kinds.ts')}`,
      label: 'PageKinds',
    },
  ],
  tests: {
    path: `file://${join(import.meta.dirname, 'tests.ts')}:kinds`,
    config: { answerKey: answerKeyFile, pages: cache },
  },
  // The scores of the whole run that are not ratios of sums: the confusion
  // matrix and the macro and weighted averages.
  extensions: [
    `file://${join(import.meta.dirname, 'summary', 'page-kinds.ts')}:afterAll`,
  ],
  // As many calls at once as the app makes.
  evaluateOptions: { maxConcurrency: new PageKinds().concurrency },
} satisfies UnifiedConfig;
