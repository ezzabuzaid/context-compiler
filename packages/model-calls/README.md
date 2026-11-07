# @workspace/model-calls

An app of this repository asks a model about each item of a rule, such as a page or an email. Its rules all decide two things in the same way. This package holds both.

## Which call failures fail one item

```ts
import { NoObjectGeneratedError, NoOutputGeneratedError } from 'ai';

import { CallFailures } from '@workspace/model-calls/call-failures';

const failures = new CallFailures(
  NoObjectGeneratedError,
  NoOutputGeneratedError,
);

try {
  // generateText(…)
} catch (error) {
  return { error: failures.reason(error) };
}
```

`reason(error)` gives the reason that a call failed for its item, or throws the error:

- A call that failed after the retries of the AI SDK is the failure of its item. The reason is the message of the last call's `APICallError`.
- A 401 throws. Every call would fail, so the run fails.
- An answer error that the rule names is the failure of its item. The answer errors are different for each call: `generateText` has `NoObjectGeneratedError` and `NoOutputGeneratedError`, and `experimental_decide` has `Experimental_DecisionRefusalError` and `InvalidResponseDataError`.
- Every other error throws, a stop among them.

## A rule's identity

```ts
import { ruleIdentity } from '@workspace/model-calls/rule-identity';

const identity = ruleIdentity(model.modelId, { system, schema, settings });
```

`ruleIdentity(modelId, sent)` gives `<modelId>:<hash>`. The hash is the SHA-256 of the JSON of `sent`: what the rule sends besides each item. A computed dataset computes every row of a rule again when its identity changes. So a new model, or a changed prompt, schema or setting, gives new output. `{ digits: 16 }` keeps only the first 16 hex digits of the hash.

## `ai` is a peer dependency

Each app pins its own version of `ai`. The `isInstance` check of an AI SDK error reads a marker symbol, not the class, so an error from the app's `ai` matches the classes of this package's `ai`.
