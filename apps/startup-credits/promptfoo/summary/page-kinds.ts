import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  ClassCounts,
  LabelCase,
  LabelComparer,
  MacroAverage,
  WeightedAverage,
} from '@zukhruf/evals/classification';
import {
  type AfterAllExtensionHookContext,
  type EvaluateResult,
  ResultFailureReason,
} from 'promptfoo';
import { z } from 'zod';

import { pageKinds } from '../../src/rules/page-kinds.ts';
import { latestResults } from './latest-results.ts';

// The kind of the label, which tests.ts gives each row as metadata.
const metadataSchema = z.object({ kind: z.string() });

const comparer = new LabelComparer({ labels: pageKinds });
const macro = new MacroAverage();
const weighted = new WeightedAverage();

// The scores of one prompt (a prompt and a provider) over its pages, as
// scikit-learn gives them with labels=pageKinds: the classes are the app's
// page kinds, in their order, and a failed page's "null" is a miss of its
// kind and no class of its own (ADR 0006 of @zukhruf/evals).
function summarize(rows: readonly EvaluateResult[]) {
  const counts = new ClassCounts({ labels: pageKinds, multilabel: false });
  for (const row of rows) {
    const testCase = new LabelCase({
      expected: metadataSchema.parse(row.testCase.metadata).kind,
      weight: 1,
    });
    counts.add(
      comparer.compare(row.response?.output, testCase),
      testCase.weight,
    );
  }
  const matrix = counts.confusionMatrix();
  const averages = (score: (options: { average: MacroAverage }) => number) => ({
    macro: score({ average: macro }),
    weighted: score({ average: weighted }),
  });
  return {
    pages: rows.length,
    accuracy: counts.accuracy(),
    precision: averages((options) => counts.precision(options)),
    recall: averages((options) => counts.recall(options)),
    f1: averages((options) => counts.fBeta({ ...options, beta: 1 })),
    support: Object.fromEntries(counts.support()),
    // A row is the label, a column the answer.
    confusion_matrix: { labels: matrix.labels, rows: matrix.rows() },
  };
}

// promptfoo's afterAll extension hook: the scores of the whole run that are
// not ratios of sums, so no column of promptfoo shows them. Written to
// results/<eval id>.json in the folder that promptfoo runs in, as -o writes
// its output. A row that is an error has no answer to score, so a run with
// one writes no summary until promptfoo retry runs its error rows again.
export async function afterAll(
  context: AfterAllExtensionHookContext,
): Promise<void> {
  const rows = latestResults(context.results);
  const errors = rows.filter(
    (row) => row.failureReason === ResultFailureReason.ERROR,
  );
  if (errors.length > 0) {
    console.log(
      `\nNo summary: ${errors.length} rows are errors. Run them again with nx run startup-credits:promptfoo-retry --args=${context.evalId}`,
    );
    return;
  }
  const summaries = context.prompts.map((prompt, promptIdx) => ({
    provider: prompt.provider,
    prompt_idx: promptIdx,
    ...summarize(rows.filter((row) => row.promptIdx === promptIdx)),
  }));
  const folder = resolve('results');
  await mkdir(folder, { recursive: true });
  // An eval id holds the time with colons (eval-Cqc-2026-11-04T07:05:01),
  // which Windows forbids in a file name.
  const file = join(folder, `${context.evalId.replaceAll(':', '-')}.json`);
  await writeFile(
    file,
    `${JSON.stringify({ eval_id: context.evalId, summaries }, null, 2)}\n`,
  );
  console.log(`\nSummary: ${file}`);
}
