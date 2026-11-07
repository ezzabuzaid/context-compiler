import { join } from 'node:path';

import type { UnifiedConfig } from 'promptfoo';

import { answerKeyFile } from '../eval/answer-key.ts';
import { cache } from '../eval/pages.ts';
import { ProgramOffers } from '../src/rules/program-offers.ts';

// The paths are absolute, so a config that spreads this one from another
// folder, as the eval's test does with its own answer key and cache, names
// the same provider and generator.
export default {
  description:
    "The offers that the app's ProgramOffers rule states on each test page",
  // The input of the harness is the page to read.
  prompts: ['{{url}}'],
  providers: [
    {
      id: `file://${join(import.meta.dirname, 'providers', 'program-offers.ts')}`,
      label: 'ProgramOffers',
    },
  ],
  tests: {
    path: `file://${join(import.meta.dirname, 'tests.ts')}:load`,
    config: { answerKey: answerKeyFile, pages: cache },
  },
  // As many calls at once as the app makes.
  evaluateOptions: { maxConcurrency: new ProgramOffers().concurrency },
} satisfies UnifiedConfig;
