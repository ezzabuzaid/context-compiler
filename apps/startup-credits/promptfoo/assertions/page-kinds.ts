import { F1, Precision, Recall, ScorerSet } from '@zukhruf/evals';
import {
  AllClassMatches,
  LabelComparer,
  LabelConfigCase,
  LabelsMatch,
  PerClass,
} from '@zukhruf/evals/classification';
import { PromptfooAssertion } from '@zukhruf/evals/promptfoo';

// The kind that the harness chose against the kind of the label. A page whose
// call failed answers the label "null", so it stays in the wholes. The
// classes of each column are the labels that the answers and the labels hold,
// as scikit-learn's labels=None: a kind that no page has and no answer
// chooses has no column. Each ratio keeps its whole, so promptfoo's column
// of a class is the ratio of sums over the rows.
export default new PromptfooAssertion(
  new ScorerSet(
    {
      accuracy: new LabelsMatch(),
      precision: new PerClass(new Precision(new AllClassMatches())),
      recall: new PerClass(new Recall(new AllClassMatches())),
      f1: new PerClass(new F1(new AllClassMatches())),
    },
    { comparer: new LabelComparer() },
  ),
  new LabelConfigCase(),
).grade;
