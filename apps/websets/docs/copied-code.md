# Code copied into this app

The Rule of Three counts places, not packages. Code that a second place needs is copied, and it is extracted only when a third place needs it. A tiny helper stays copied even then, as a little copying is better than a little dependency (backlog #3371). A fix in one copy is made in the other copies too, and the commit names each file.

## The data folder

**`apps/what-is-going-on/src/directory.ts` → `src/directory.ts`, with the folder named `websets`.**
The app keeps its files in a `websets` folder under `XDG_DATA_HOME`, or under `~/.local/share` when that is not set, and makes the folder when the app starts. Each test gives the app a temporary `XDG_DATA_HOME`. The places with this concept are listed in `apps/startup-credits/docs/copied-code.md`; it stays copied as a tiny helper (#3371).

## How a page's article is read on demand

**`src/routes/fetch.route.ts` → `src/checks/page-check.ts` (`PageCheck.read`), with a failed read in place of an error entry.**
A page is read with `WebArticle` (Markdown first, then HTML) through the client of `src/web-client.ts`, so the website's robots.txt, its delay and the HTTP cache apply. A page with no article fails with "The page has no article". An `ArticleError` fails with the message of its cause, and any other error propagates. The client saves its records after the read. The fetch route answers each failure as an error of the call; a page monitor records it as a failed run. A third place extracts it (backlog #3975).

## How a cursor of the event log is answered

**`src/routes/events.route.ts` → `src/routes/monitor-events.route.ts`, with the monitor's events in place of the dataset's.**
A cursor of an earlier log answers 410 `resync_required`, and a cursor that the API never gave answers 400 `invalid_cursor`. The dataset's 410 message tells the consumer to list the items again; a monitor has no items, so its message tells it only to read the events from the new start. A third place extracts it (backlog #3976).

## A data version that opens at its first read

**elt `packages/sdks/macos/app-database/src/app-database-version.ts` (`AppDatabaseVersion`) → `src/definitions/store-version.ts` (`StoreVersion`), without the unavailable state.**
A change signal's gauge opens what it reads at its first read (elt ADR 0020), and `DataVersion` of `@zukhruf/sqlite-data-version` opens its database when it is made, so the gauge holds a closed state that opens a `DataVersion` at the first read and an open state that reads it. `AppDatabaseVersion` also reads an app's store that is missing or that the process cannot open as `'unavailable'`; api.sqlite is always there, since the API makes it before the pipeline starts, so `StoreVersion` has no such state. A third place extracts it (backlog #3998).
