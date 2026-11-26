# Context Compiler

**Import your Mac apps into SQLite.**

Context Compiler is a terminal CLI that imports what the apps on a Mac keep (Notes, Mail, Messages, Calendar, Reminders, Contacts, Safari, Dia, Google Chrome, Arc, Microsoft Edge, Books, Activity, Accounts, Call History, Clock, Notification Center, Wallet, Slack, Microsoft Teams, WhatsApp and Instagram) and the listings of the OpenSooq categories you pick into one SQLite database per connector, and keeps it current. An agent reads those databases directly with `sqlite3 -readonly`. Everything stays on the Mac.

The sources, the SQLite destination and the pipeline that loads them are the [elt](https://github.com/ezzabuzaid/elt) library. This repository holds the CLI, one connector package per app, and the settings they share. See the README of each [elt source package](https://github.com/ezzabuzaid/elt/tree/main/packages/sources) for its streams, fields and limits, for example [Mail streams](https://github.com/ezzabuzaid/elt/blob/main/packages/sources/apple/mail/README.md).

[CLI](#cli) · [Permissions](#permissions) · [Development](#development) · [Connectors and their hosts](docs/connectors-and-hosts.md)

## CLI

[`apps/cli`](apps/cli/src/main.ts) imports the connectors from a terminal. Use **Node.js 26** and npm on macOS; Calendar and Reminders require **macOS 27**, the release the EventKit helper is built for. The CLI runs from a checkout (see [Development](#development)). The CLI keeps settings, imports, checkpoints and attachment files in `~/Library/Application Support/Context Compiler/Imports` by default. Pass `--directory <path>` before the command to use a separate store. Read the store with:

```sh
npx nx run cli:start -- status
```

Commands run with `npx nx run cli:start -- [--directory <path>] <command>`:

- `setup` asks which connectors to import and, optionally, which accounts, collections and dates to narrow each one to; `setup --connector notes --collection <id> --since 2025-01-01 --connector mail` does the same without prompts, each narrowing flag applying to the `--connector` before it and each date a `YYYY-MM-DD` day on this Mac's clock, and `options <connector>` lists the IDs. Changing a connector's selection removes its import, so the next sync loads it again; an import another sync is loading is removed by the next `setup` or `sync`.
- `sync` loads every selected connector once, showing each stream's progress; run it again, or use `sync watch`, to refresh. A sync that finds another sync loading a connector says so, waits for that pass and shows its outcome instead of loading it again; if that other sync is killed first, it shows the connector as interrupted and exits 1. `status` never keeps a sync from starting. Ctrl-C stops a sync at once with exit status 130; what it committed stays, and the next sync resumes it.
- `sync watch` keeps every selected connector current, or only those `--connector` names. It loads each one at once, then again each time its app's store changes, until Ctrl-C or SIGTERM stops it. A connector is current only as far as its app's store on this Mac: WhatsApp and Notes stop writing theirs while closed, Safari stops syncing history and iCloud Tabs while closed, Slack, Teams and Mail save theirs only now and then, and Wallet fetches passes from iCloud once a day, so their data is as of that last write or fetch. One process owns an import at a time: a second `sync watch` of it waits and takes over when the first stops, and a `sync` of it says the watch keeps it current and loads nothing. A `setup` that removes a watched connector stops its watch within a second or two, and the next `setup` or `sync` removes its import. A connector whose source stops reporting changes stops alone and says so. Watching Notes opens Notes hidden, because only Notes syncs iCloud notes.
- `sync watch start` keeps every selected connector current in the background. It loads a LaunchAgent (a launchd job of your user) for this store. The job runs `sync watch` from now on, starts it at each login, and starts it again when it dies; a second `sync watch start` leaves a running job as it is. macOS gives a background program no access through the terminal app. Add the `node` binary that the command prints to System Settings › Privacy & Security › Full Disk Access, then run `sync watch restart`. Until then, the connectors that need that access fail, and `status` names that binary. Run `sync watch start` again after a Node.js upgrade that moves `node`. The job gets `HOME` and `XDG_CONFIG_HOME` as `sync watch start` saw them, and writes its own errors to `sync-watch.log` in the store. `sync watch restart` ends the job's process and runs it again. `sync watch stop` stops the job and removes it.
- `status` lists every connector with separate Configuration (enabled or disabled) and Sync columns. Enabled connectors come first and show their latest pass, last success and database; disabled connectors have no sync state. With `--json`, `enabled` is a boolean and `state` is the sync state (`null` when disabled, `never` when enabled but not synced), with each stream's status too. A pass a killed sync left shows as running until the next sync.
- `query <connector> --tables` lists each stream's view, its rows and its declared coverage, and `query <connector> "<sql>"` runs one read-only statement. Each connector's `catalog` view lists every view and column with its description.

Each import's `<directory>/<connector>/<selection>/data.sqlite` holds described views named after their streams (`inline_attachments` for `inlineAttachments`), each over its table `raw_<view>`, with the sync history and `catalog` views elt-sqlite publishes. macOS grants access to the terminal app that runs the CLI, so it needs its own Full Disk Access, Contacts, Calendar and Reminders grants; a connector denied access fails alone and names the grant. Without a terminal, or with `--json`, output is JSON (one line per pass for `sync`) and nothing prompts.

Calendar reads occurrences from 2000-01-01 to a year ahead unless the selection narrows the dates, and its import downloads attachments stored in Google Drive and Gmail. That needs your own Google OAuth client in `~/.config/context-compiler/client_secret.json` (under `$XDG_CONFIG_HOME` when it is set): in Google Cloud Console › APIs & Services › Credentials, create an OAuth client ID of type Desktop app in a project with the Drive and Gmail APIs enabled, download its JSON and save it as that file. It is the file gws keeps as `~/.config/gws/client_secret.json`. The first Calendar sync opens a browser for consent. Contacts account names (iCloud, Google) are not in its stores and do not load.

The Notes connector reads Notes' own store, `NoteStore.sqlite`, so Notes does not need to be open. macOS protects that store: allow the terminal app you run Nx from **Full Disk Access** in **System Settings → Privacy & Security → Full Disk Access**.

### Clock

```sh
npx nx run cli:start -- setup --connector clock --sync
npx nx run cli:start -- sync --connector clock
```

Clock reads saved alarms, timers and recent durations, world clocks, the current stopwatch and its laps, sounds and regional calendar records. Open Clock once to create its stores; it need not stay open. Unchanged records are skipped and removed objects disappear from the import. Resetting the stopwatch removes its laps; there is no recovered session history. Removing a recent timer can leave its stored duration marked invalid. See [Clock's ten streams, access requirements and live checks](https://github.com/ezzabuzaid/elt/blob/main/packages/sources/apple/clock/README.md).

### Reminders

```sh
npx nx run cli:start -- setup --connector reminders
npx nx run cli:start -- sync --connector reminders
```

Reminders reads through EventKit, so Reminders.app need not be open. Grant the terminal app full access in **System Settings → Privacy & Security → Reminders**. Each sync writes only changed reminders and deletes removed ones. Due and start dates are exported as raw date components, so date-only and floating reminders are never shifted into UTC. Apple exposes only the next incomplete occurrence of a recurring reminder. See [Reminders streams](https://github.com/ezzabuzaid/elt/blob/main/packages/sources/apple/reminders/README.md) for all eight streams and their limits.

### Audio transcription

Audio transcription is off until you choose a speech model installed on this Mac by its file name with `--transcription-model`. The CLI finds the model through Spotlight and in the Hugging Face cache, whichever app or tool installed it, and saves the choice in its store; `off` turns it off. Cohere Transcribe Arabic transcribes Arabic and English speech. Audio stays on this Mac; existing and new imported attachments become searchable through `attachment_text`. Turning it off keeps existing transcripts.

```sh
npx nx run cli:start -- --transcription-model cohere-transcribe-arabic-07-2026-Q8_0.gguf sync --connector whatsapp
npx nx run cli:start -- --transcription-model off status
```

Local transcription decodes audio with macOS's `afconvert`, so it needs nothing installed. Building the native worker requires Rust/Cargo and CMake; Nx builds it automatically. Installed models are reused in place and are never modified.

## Permissions

Permissions apply to the process running the import: the terminal app that runs the CLI. A sandbox can still restrict access after permission is granted.

| Operation                                               | Required access                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read or watch Apple Mail                                | Full Disk Access (Mail's store and the system Accounts store, which holds account settings); Mail does not need to be open, but only Mail downloads newer messages and missing content, so sync does not fetch cloud mail                                             |
| Read or watch Dia, Google Chrome, Arc or Microsoft Edge | No access to grant; the browser may stay open                                                                                                                                                                                                                         |
| Read or watch Apple Notes                               | Full Disk Access; Notes does not need to be open, but only Notes finishes syncing iCloud changes                                                                                                                                                                      |
| Read or watch Apple Contacts                            | Contacts access or Full Disk Access; Contacts does not need to be open                                                                                                                                                                                                |
| Read or watch Apple Safari                              | Full Disk Access; Safari does not need to be open, but only Safari fetches history and tabs from other devices                                                                                                                                                        |
| Read or watch Apple Books                               | Full Disk Access; Books does not need to be open, and books kept only in iCloud are listed without their files                                                                                                                                                        |
| Read or watch Mac activity                              | Full Disk Access (Biome and knowledgeC); no app needs to be open                                                                                                                                                                                                      |
| Read or watch Apple Accounts                            | Full Disk Access; no app needs to be open                                                                                                                                                                                                                             |
| Read or watch Apple Clock                               | Access to the protected database and city preferences, covered by Full Disk Access; stopwatch preferences were readable without that grant on macOS 27                                                                                                                |
| Read or watch Reminders                                 | Full Reminders access through EventKit                                                                                                                                                                                                                                |
| Read or watch Calendar                                  | Full Calendar access through EventKit                                                                                                                                                                                                                                 |
| Read or watch Apple Messages                            | Full Disk Access; only messages synced to this Mac are imported                                                                                                                                                                                                       |
| Read or watch call history                              | Full Disk Access; no app needs to be open: macOS keeps the calls from Phone, FaceTime and your iPhone in one store                                                                                                                                                    |
| Read or watch Notification Center                       | Full Disk Access; no app needs to be open, and only the notifications Notification Center still holds are imported                                                                                                                                                    |
| Read or watch Wallet                                    | No access to grant; no app needs to be open, and the passes iCloud brings from your iPhone are imported too                                                                                                                                                           |
| Read or watch Slack                                     | Full Disk Access; open Slack in each workspace and let it run: it saves what it has loaded when its window is hidden or closed, when it loses the network, and about once an hour while the window stays visible, and only what it has loaded on this Mac is imported |
| Read or watch Microsoft Teams                           | Full Disk Access; open Teams, sign in and let it run: only what it has loaded on this Mac is imported                                                                                                                                                                 |
| Read or watch WhatsApp                                  | Full Disk Access; open WhatsApp and let it run: it saves new messages to this Mac only while it runs                                                                                                                                                                  |
| Read Instagram profiles                                 | Sign in to Instagram in Dia, Google Chrome, Arc, Microsoft Edge or Brave, and click Always Allow when macOS asks whether security may use the browser’s Safe Storage key                                                                                              |

Manage permissions in **System Settings → Privacy & Security**. Calendar and Reminders request access on the first native operation if it is undecided.

## Development

```text
packages/connectors/   One package per connector (connector-<source>), with
                       Connector (connector) and discovery
                       (connector-manifest)
packages/settings/     The selection and settings the CLI keeps in settings.sqlite
apps/cli/              Terminal CLI: setup, sync, status, query (cli)
docs/                  Host behavior and verification notes
```

### Sibling checkout of elt

This repository uses the elt packages (`@eltjs/elt`, `@eltjs/elt-sqlite`, the sources, SDKs and codecs) from a checkout of [elt](https://github.com/ezzabuzaid/elt) beside it. The elt packages without `"private": true` are published to npm under `@eltjs`, but this repository uses the links for all of them. It cannot take only the published ones from npm: a linked source loads elt's own copy of `@eltjs/elt`, and a pipeline from the npm copy refuses its streams, because `Stream` of one copy is not `Stream` of the other. A peer dependency does not change this: Node looks for `@eltjs/elt` from the real path of the linked source, which is in the elt checkout. The root `package.json` lists `../elt/packages/*` and its sibling globs as npm workspaces. npm links each one into `node_modules` and leaves its dependencies to elt's own `node_modules`, so run `npm install` in elt too; the packages both repositories import (zod, `@zukhruf/sqlite-drift`, `@zukhruf/sqlite-transaction`, `ai`) keep the same versions on both sides. The `.npmrc` points the `@workspace` scope at an address nothing listens on, so npm fails on a package that is not linked instead of fetching a stranger's package of that name from the public registry (dependency confusion).

```sh
git clone https://github.com/ezzabuzaid/elt.git
git clone https://github.com/ezzabuzaid/context-compiler.git
cd elt && npm install && npx nx run-many -t build && cd ..
cd context-compiler && npm install
```

Build elt again after you change it.

### Checks

Run checks from the repository root:

```sh
npx nx run-many -t typecheck
npx nx run-many -t test
```

`typecheck` first runs the project's `format:check` target (Prettier, which checks the format and the import order, and writes no file; `format` writes) and its `lint` target (ESLint, with the configs of `@zukhruf/eslint`; `@zukhruf/nx/lint` makes each package that ESLint loads an input of the `lint` cache). The pre-commit hook (`.husky/pre-commit.ts`, from `@zukhruf/git-hooks`) runs `nx sync`, stages only the files that sync wrote, and checks the staged copy of each file with Prettier. It also checks how npm installs: no numeric Node or npm pin, the two settings of `.npmrc`, a lockfile that records each staged `package.json`, `npm ci` in each Dockerfile, and a lint of the `package.json` of each touched project. It does not lint the source or type-check, so run `npx nx run <project>:typecheck` for each project you change before you commit. Test targets build first and use Node's test runner.

Run apps only through their Nx targets: `start` builds the app and its packages first and loads the workspace `.env` (gitignored). Node's default TypeScript stripping does not support the parameter properties used here, so the targets run the built JavaScript.

### Adding a connector

Add the source in elt first, with elt's [add-elt-source skill](https://github.com/ezzabuzaid/elt/blob/main/.agents/skills/add-elt-source/SKILL.md). Then register its connector here with the [register-connector skill](.agents/skills/register-connector/SKILL.md). [Connectors and their hosts](docs/connectors-and-hosts.md) describes how the CLI discovers, loads and imports connectors.
