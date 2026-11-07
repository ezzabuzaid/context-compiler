# Code copied into this app

The Rule of Three counts places, not packages. Code that a second place needs is copied, and it is extracted only when a third place needs it. A tiny helper stays copied even then, as a little copying is better than a little dependency (backlog #3371). A fix in one copy is made in the other copies too, and the commit names each file.

## The data folder

**`apps/what-is-going-on/src/directory.ts` → `src/directory.ts`, with the folder named `websets`.**
The app keeps its files in a `websets` folder under `XDG_DATA_HOME`, or under `~/.local/share` when that is not set, and makes the folder when the app starts. Each test gives the app a temporary `XDG_DATA_HOME`. The places with this concept are listed in `apps/startup-credits/docs/copied-code.md`; it stays copied as a tiny helper (#3371).

## Which model call failures fail a page

**`apps/startup-credits/src/rules/program-offers.ts` (`ProgramOffers.#offers`) → `src/call-failure.ts` (`callFailure`), as a function that `Evaluation`, `FieldValue` and the search route share.**
A call that failed after the AI SDK's retries is the failure of that call (one page, or one search): the rule takes the last error of a `RetryError` and returns the message of an `APICallError`. A 401 fails the dataset, as every page would fail. `NoObjectGeneratedError` and `NoOutputGeneratedError` are a page's failure. The other places are `PageKinds` (`apps/startup-credits/src/rules/page-kinds.ts`) and `InvoicePayments` (`apps/ipay/src/rules/invoice-payments.ts`). It stays copied: six lines, and a shared home would be a new dependency of each app.

## A rule's identity

**`apps/startup-credits/src/rules/program-offers.ts` (`identity`) → `src/rules/evaluation.ts` (`Evaluation.identity`) and `src/rules/field.ts` (`FieldValue.identity`), with the criterion or the field in place of the program's prompt.**
The identity is the model's id and the SHA-256 of the instructions, the prompt, the schema and the settings, so a changed prompt judges or reads every page again. The other places are `PageKinds` (the model's id and the hash of its questions) and `InvoicePayments` (`apps/ipay/src/rules/invoice-payments.ts`). It stays copied: one expression, and a shared home would be a new dependency of each app.

## How a page's article is read on demand

**`src/routes/fetch.route.ts` → `src/checks/page-check.ts` (`PageCheck.read`), with a failed read in place of an error entry.**
A page is read with `WebArticle` (Markdown first, then HTML) through the client of `src/web-client.ts`, so the website's robots.txt, its delay and the HTTP cache apply. A page with no article fails with "The page has no article". An `ArticleError` fails with the message of its cause, and any other error propagates. The client saves its records after the read. The fetch route answers each failure as an error of the call; a page monitor records it as a failed run. A third place extracts it (backlog #3975).

## How a cursor of the event log is answered

**`src/routes/events.route.ts` → `src/routes/monitor-events.route.ts`, with the monitor's events in place of the dataset's.**
A cursor of an earlier log answers 410 `resync_required`, and a cursor that the API never gave answers 400 `invalid_cursor`. The dataset's 410 message tells the consumer to list the items again; a monitor has no items, so its message tells it only to read the events from the new start. A third place extracts it (backlog #3976).
