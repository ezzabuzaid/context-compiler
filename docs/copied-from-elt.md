# Code copied from elt

This repository was split from elt on 2026-10-23. elt keeps the library; this repository keeps the plugin, the CLI, the connectors and the settings. Some lint configuration is in both repositories. Each repository keeps its own copy and does not share it yet.

The reason is the Rule of Three. It counts places, not packages. Code that a second place needs is copied, and it is extracted only when a third place needs it. When a third repository needs this configuration, the shared parts move to one home (backlog #2881). Until then, a fix in one copy is made in the other copy too, and the commit names both files. This note is the input for that step.

Paths on the left are in elt. Paths on the right are in this repository.

## Copied without a change

| elt                          | context-compiler             |
| ---------------------------- | ---------------------------- |
| `personal.eslint.config.mjs` | `personal.eslint.config.mjs` |

## Copied with changes

**`eslint.config.mjs` → `eslint.config.mjs`.**
These parts are copied without a change: `testHookRestrictedSyntax`, `enumRestrictedSyntax`, `mswUnhandledRequestSyntax`, the rule block for all script files, and `reportUnusedDisableDirectives`.
These parts are different:

- This repository has no islands. It does not import `island.eslint.config.mjs`, and its `depConstraints` has no `islandConstraint`, `layer:sdk` or `layer:codec` entry.
- elt applies `no-process-env` and `no-console` to `packages/**` through `island({ libraries })`. This repository uses the ESLint core rules `no-console` and `no-restricted-properties` (`process.env`) for the same files.
- The `ignores` entry also names `plugins/context-compiler/server`, the bundled plugin server. elt has no bundle to ignore.
- `@nx/enforce-module-boundaries` has a `checkDynamicDependenciesExceptions` entry for `@workspace/source-apple-calendar`. The Calendar connector imports that package both with `import()` and statically. elt has no consumer that does this.

Why: the island rules check packages that are written as if published to npm. No package in this repository is one, so only the two rules for library code stay.

## Not copied

The pre-commit check is not copied. The `.husky/pre-commit.ts` of each repository runs the `Sync` and `Format` steps of `@zukhruf/git-hooks`, and the code of the check is in that package.
