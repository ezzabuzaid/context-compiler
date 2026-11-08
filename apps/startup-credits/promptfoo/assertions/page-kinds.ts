import { F1, Precision, Recall, ScorerSet } from '@zukhruf/evals';
import {
  AllClassMatches,
  LabelComparer,
  LabelConfigCase,
  LabelsMatch,
  PerClass,
} from '@zukhruf/evals/classification';
import { PromptfooAssertion } from '@zukhruf/evals/promptfoo';

import { pageKinds } from '../../src/rules/page-kinds.ts';

// The kind that the harness chose against the kind of the label. The classes
// are the app's page kinds (ADR 0006 of @zukhruf/evals): a page whose call
// failed answers the label "null", which is a miss of its kind and no class
// of its own. A kind that no page has and no answer chooses has no column.
// Each ratio keeps its whole, so promptfoo's column of a class is the ratio
// of sums over the rows.
export default new PromptfooAssertion(
  new ScorerSet(
    {
      accuracy: new LabelsMatch(),
      precision: new PerClass(new Precision(new AllClassMatches())),
      recall: new PerClass(new Recall(new AllClassMatches())),
      f1: new PerClass(new F1(new AllClassMatches())),
    },
    { comparer: new LabelComparer({ labels: pageKinds }) },
  ),
  new LabelConfigCase(),
).grade;
