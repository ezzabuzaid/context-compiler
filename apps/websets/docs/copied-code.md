# Code copied into this app

The Rule of Three counts places, not packages. Code that a second place needs is copied, and it is extracted only when a third place needs it. A tiny helper stays copied even then, as a little copying is better than a little dependency (backlog #3371). A fix in one copy is made in the other copies too, and the commit names each file.

## The data folder

**`apps/what-is-going-on/src/directory.ts` → `src/directory.ts`, with the folder named `websets`.**
The app keeps its files in a `websets` folder under `XDG_DATA_HOME`, or under `~/.local/share` when that is not set, and makes the folder when the app starts. Each test gives the app a temporary `XDG_DATA_HOME`. The places with this concept are listed in `apps/startup-credits/docs/copied-code.md`; it stays copied as a tiny helper (#3371).

## Where a quote is in a text

**`apps/ipay/src/rules/ground.ts` (`ground`) → `src/ground.ts`, unchanged.**
An evaluation or a field keeps the model's quote only when the quote is in the page text, ignoring case and the kind and number of spaces. This is the third place, after `apps/startup-credits/src/ground.ts` and ipay: strike 3, so `ground` is extracted (#3677).

## Which model call failures fail a page

**`apps/startup-credits/src/rules/program-offers.ts` (`ProgramOffers.#offers`) → `src/rules/evaluation.ts` (`pageFailure`), as a function that `Evaluation` and `FieldValue` share.**
A call that failed after the AI SDK's retries is the failure of one page: the rule takes the last error of a `RetryError` and returns the message of an `APICallError`. A 401 fails the dataset, as every page would fail. `NoObjectGeneratedError` and `NoOutputGeneratedError` are a page's failure. The other places are `PageKinds` (`apps/startup-credits/src/rules/page-kinds.ts`) and `InvoicePayments` (`apps/ipay/src/rules/invoice-payments.ts`). It stays copied: six lines, and a shared home would be a new dependency of each app.

## A rule's identity

**`apps/startup-credits/src/rules/program-offers.ts` (`identity`) → `src/rules/evaluation.ts` (`Evaluation.identity`) and `src/rules/field.ts` (`FieldValue.identity`), with the criterion or the field in place of the program's prompt.**
The identity is the model's id and the SHA-256 of the instructions, the prompt, the schema and the settings, so a changed prompt judges or reads every page again. The other places are `PageKinds` (the model's id and the hash of its questions) and `InvoicePayments` (`apps/ipay/src/rules/invoice-payments.ts`). It stays copied: one expression, and a shared home would be a new dependency of each app.
