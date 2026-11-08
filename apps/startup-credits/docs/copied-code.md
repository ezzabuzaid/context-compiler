# Code copied into this app

The Rule of Three counts places, not packages. Code that a second place needs is copied, and it is extracted only when a third place needs it. A tiny helper stays copied even then only when its shared home would give a consumer a dependency that the consumer does not have yet, such as a third-party package: a little copying is better than a little dependency. The rule says: "Tiny helpers in a package with a different dependency profile stay copied" (backlog #4003). A fix in one copy is made in the other copies too, and the commit names each file.

## The data folder

**`apps/what-is-going-on/src/directory.ts` → `src/directory.ts`, with the folder named `startup-credits`.**
The app keeps its files in a `startup-credits` folder under `XDG_DATA_HOME`, or under `~/.local/share` when that is not set, and makes the folder when the app starts. Each test gives the app a temporary `XDG_DATA_HOME`. The same module is in `apps/websets` and `apps/logful`, so it is in 4 places, and its extraction is due (backlog #4012).

`datahub` (`apps/semantic-layer/elt/src/directory.ts`) has the same concept with one difference: its folder is `outputs/`, next to its code.

## The latest result of each test

**`offers-evals` `apps/sob/src/summary/latest-results.ts` → `promptfoo/summary/latest-results.ts`, with the same code; only the comments differ.**
After a retry, promptfoo gives the `afterAll` hook each error result next to the result of its retry. `latestResults` keeps one result for each test: the result that is not an error, or one error result when the error results have the same scores. The page-kinds summary reads only these results. A third place that reads the results of `afterAll` after a retry extracts the function, probably into `@zukhruf/evals/promptfoo` (backlog #3996).

## Test helpers

Each helper below is in two tests of this app. When a third test needs a helper, the helper moves into `src/testing/`, next to `promptfoo.ts` (backlog #3972). The runner of the promptfoo CLI moved there in this way.

- **The Codex Responses stub:** `src/startup-credits.test.ts` → `promptfoo/test-pages.test.ts`. msw answers at the wire with the SSE events of the Responses API, and a fake JWT login in a temporary `CODEX_HOME` signs in the calls.
- **The OpenRouter Decisions stub:** `src/startup-credits.test.ts` → `promptfoo/page-kinds.test.ts`. msw answers only a call that has the test key and the text of the page.
- **The answer key and cache builders** (`answerKeyOf`, `cacheOf`, `sha256`): `promptfoo/test-pages.test.ts` → `promptfoo/page-kinds.test.ts`. The page-kinds copy keeps the kinds only, with no offers or lookalikes.
