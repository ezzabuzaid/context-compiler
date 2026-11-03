# Code copied into this app

The Rule of Three counts places, not packages. Code that a second place needs is copied, and it is extracted only when a third place needs it. A tiny helper stays copied even then, as a little copying is better than a little dependency (backlog #3371). A fix in one copy is made in the other copies too, and the commit names each file.

## The decision model of OpenRouter's Decisions API

**`apps/startup-credits/src/rules/decision-model.ts` (`openRouterDecisionModel`) → `src/rules/decision-model.ts`, unchanged.**
A decision model by its id, through `@ai-sdk/typesafe-ai`, at OpenRouter's `/api/alpha/decisions`, with `OPENROUTER_API_KEY`. Strike 2: the backlog item for a third place is #3714.

## Which decision failures fail an email

**`apps/startup-credits/src/rules/page-kinds.ts` (`PageKinds.compute`) → `src/rules/payment-kinds.ts` (`PaymentKinds.compute`), with one addition.**
A refused or malformed answer (`Experimental_DecisionRefusalError`, `InvalidResponseDataError`) and a call that failed after the AI SDK's retries are the failure of one email; a 401 fails the dataset. The addition: a `LoadAPIKeyError` is thrown again with a message that names `OPENROUTER_API_KEY`, as the provider names its own `TYPESAFE_AI_API_KEY`.

## A decision rule's identity

**`apps/startup-credits/src/rules/page-kinds.ts` (`identity`) → `src/rules/payment-kinds.ts` (`identity`), with ipay's three questions in place of the page-kind question.**
The identity is the model's id and the first 16 hex digits of the SHA-256 of the questions, so a reworded question decides every email again.

## Which model call failures fail an email

**`apps/startup-credits/src/rules/program-offers.ts` (`ProgramOffers.#offers`) → `src/rules/invoice-payments.ts` (`InvoicePayments.#payments`), unchanged.**
A call that failed after the AI SDK's retries is the failure of one email: the rule takes the last error of a `RetryError` and returns the message of an `APICallError`. A 401 fails the dataset, as every email would fail. `NoObjectGeneratedError` and `NoOutputGeneratedError` are an email's failure. This is the third place, after `ProgramOffers` and `PageKinds` (`apps/startup-credits/src/rules/page-kinds.ts`, with the errors of `experimental_decide`). It stays copied: six lines, and a shared home would be a new dependency of both apps.

## A rule's identity

**`apps/startup-credits/src/rules/program-offers.ts` (`identity`) → `src/rules/invoice-payments.ts` (`identity`), with the email in place of the page's prompt.**
The identity is the model's id and the SHA-256 of the instructions, the schema and the settings, so a changed prompt makes every output again.

## Where Context Compiler keeps its files

**`apps/cli/src/main.ts` (`--directory` default) and `apps/server/src/main.ts` (`store`) → `src/imports.ts` (`contextCompiler`).**
`~/Library/Application Support/Context Compiler`, with the imports and `settings.sqlite` in `Imports`. ipay reads only the `selected_connectors` view of `settings.sqlite`, and its code does not import `@workspace/settings`, whose `Settings` writes the file it opens; a shared constant would be a new dependency for one line. Only its tests import `Settings`, to set Context Compiler up as a user does.
