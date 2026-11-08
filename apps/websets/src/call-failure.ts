import { NoObjectGeneratedError, NoOutputGeneratedError } from 'ai';

import { CallFailures } from '@workspace/model-calls/call-failures';

// The failures of a generateText call that are the failure of that call
// only: one page's judgment or field, or one search. An answer with no
// object or no output is one; the rest is the rule of CallFailures.
export const callFailures = new CallFailures(
  NoObjectGeneratedError,
  NoOutputGeneratedError,
);
