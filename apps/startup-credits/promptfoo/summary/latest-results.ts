import { isDeepStrictEqual } from 'node:util';

import { type EvaluateResult, ResultFailureReason } from 'promptfoo';

// The results of one run of each test, in the order of the tests. A result
// has a repeatIndex only when its test repeats (promptfoo's EvaluateResult),
// so one without is the first run.
//
// promptfoo 0.125.1 gives afterAll every row of the eval, and after a retry
// (promptfoo retry <eval id>, or eval --retry-errors) that is each stale
// error row beside its retried row: afterAll reads the rows inside
// evaluate() (dist/src/evaluator-BxCmvGtv.js:10196-10205), and the stale
// rows are deleted only after it returns (dist/src/main.js:4587 for retry,
// 5112-5116 for --retry-errors). A row is an error by its failureReason, as
// the retry selects them (main.js:4448-4450); a failed assertion also sets
// error. A retry runs again only a test that has no row that is not an
// error (evalResult-DzOq5wt9.js:1139-1146, evaluator-BxCmvGtv.js:9145-9153),
// so a row that is not an error is the latest, and two of them are not
// possible. When the retry fails again, the error rows cannot be told apart:
// a row has no time and a random id (evalResult-DzOq5wt9.js:1030,
// 1254-1280), so they are one when their scores are the same.
//
// A copy of offers-evals apps/sob/src/summary/latest-results.ts (strike 2):
// mirror every fix in both.
export function latestResults(
  results: readonly EvaluateResult[],
): EvaluateResult[] {
  const runs = Map.groupBy(
    results,
    (result) =>
      `${result.testIdx}:${result.promptIdx}:${result.repeatIndex ?? 0}`,
  );
  return [...runs.entries()]
    .map(([run, rows]) => latestOf(run, rows))
    .toSorted(
      (a, b) =>
        a.testIdx - b.testIdx || (a.repeatIndex ?? 0) - (b.repeatIndex ?? 0),
    );
}

function latestOf(
  run: string,
  rows: readonly EvaluateResult[],
): EvaluateResult {
  const answered = rows.filter(
    (row) => row.failureReason !== ResultFailureReason.ERROR,
  );
  const [first, ...rest] = answered.length > 0 ? answered : rows;
  if (first === undefined) throw new Error(`Run ${run} has no results.`);
  if (answered.length > 1)
    throw new Error(
      `Run ${run} (test:prompt:repeat) has ${answered.length} results that are not errors.`,
    );
  if (
    rest.some((row) => !isDeepStrictEqual(row.namedScores, first.namedScores))
  )
    throw new Error(
      `Run ${run} (test:prompt:repeat) has ${rows.length} error results with different scores, and promptfoo does not tell which is the latest.`,
    );
  return first;
}
