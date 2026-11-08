# Code copied into this app

The Rule of Three counts places, not packages. Code that a second place needs is copied, and it is extracted only when a third place needs it. A tiny helper stays copied even then only when its shared home would give a consumer a dependency that the consumer does not have yet, such as a third-party package: a little copying is better than a little dependency. The rule says: "Tiny helpers in a package with a different dependency profile stay copied" (backlog #4003). A fix in one copy is made in the other copies too, and the commit names each file.

## The decision model of OpenRouter's Decisions API

**`apps/startup-credits/src/rules/decision-model.ts` (`openRouterDecisionModel`) → `src/rules/decision-model.ts`, unchanged.**
A decision model by its id, through `@ai-sdk/typesafe-ai`, at OpenRouter's `/api/alpha/decisions`, with `OPENROUTER_API_KEY`. Strike 2: the backlog item for a third place is #3714.

## Where Context Compiler keeps its files

**`apps/cli/src/main.ts` (`--directory` default) and `apps/server/src/main.ts` (`store`) → `src/imports.ts` (`contextCompiler`).**
`~/Library/Application Support/Context Compiler`, with the imports and `settings.sqlite` in `Imports`. ipay reads only the `selected_connectors` view of `settings.sqlite`, and its code does not import `@workspace/settings`, whose `Settings` writes the file it opens; a shared constant would be a new dependency for one line. Only its tests import `Settings`, to set Context Compiler up as a user does.
