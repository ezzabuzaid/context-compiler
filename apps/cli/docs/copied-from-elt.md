# Code copied from elt

The CLI's status and elt's pass error both name each distinct failure once, with every stream that failed with it. The CLI keeps its own copy of that rule, separate from elt.

The rule is copied, not imported, because elt keeps its version internal (`describeFailures` is not exported) and the two texts describe different things: elt's describes one pass, the CLI's describes the latest attempt of each stream. Shared code is extracted when a third place needs the rule. Until then, a fix in one copy is made in the other copy too, and the commit names both files.

The path on the left is in `../elt/packages/elt/src`. The path on the right is in `apps/cli/src`.

## Copied with changes

**`core/copy.ts` `describeFailures()` → `imports.ts` `streamFailures()`.**
Both group failures by their exact error text, in the order each text first appears, and write `a, b: <error>; c: <other>`.

- `streamFailures()` takes each failed stream's latest error from `readPassStatus`, not the copies' failures of one pass.
- It writes no `The following copies did not load completely:` lead.

Why: status shows a connector's state from the latest attempt of each stream (#4378), which no single pass describes.
