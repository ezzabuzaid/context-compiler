# Context Compiler

**Import your Mac apps into SQLite. Ask Codex about them.**

Context Compiler is a Codex plugin and a terminal CLI that import what the apps on a Mac keep (Notes, Mail, Messages, Calendar, Reminders, Contacts, Safari, Books, Activity, Accounts, Call History, Clock, Notification Center, Wallet, Slack, Microsoft Teams, WhatsApp and Instagram) and the listings of the OpenSooq categories you pick into one SQLite database per connector, and keep it current. The plugin's skills let the agent read those databases directly with `sqlite3 -readonly`. Everything stays on the Mac.

The sources, the SQLite destination and the pipeline that loads them are the [elt](https://github.com/ezzabuzaid/elt) library. This repository holds the hosts: the plugin, the CLI, one connector package per app, and the settings they share. See the README of each [elt source package](https://github.com/ezzabuzaid/elt/tree/main/packages/sources) for its streams, fields and limits, for example [Mail streams](https://github.com/ezzabuzaid/elt/blob/main/packages/sources/apple/mail/README.md).

[Codex plugin](#codex-plugin) · [CLI](#cli) · [Permissions](#permissions) · [Development](#development) · [Connectors and their hosts](docs/connectors-and-hosts.md)

## Codex plugin

The [Context Compiler plugin](plugins/context-compiler/.codex-plugin/plugin.json) is a Codex plugin with setup and query skills and a local MCP server. To install it in Codex in the ChatGPT desktop app on a Mac:

1. Choose the **Plugins** icon in the sidebar, then **Add**, **Add a marketplace**.
2. Enter `ezzabuzaid/context-compiler` as the source and `release` as the Git ref, then choose **Add marketplace**. Sparse paths can stay empty.
3. Search for **Context Compiler**, open it and choose **Install plugin**, then **Set up Context Compiler**.

Setup asks in one form which connectors to import, each in full; a connector narrowed earlier in chat keeps that selection. Mail, Notes, Messages, Safari, Books, Activity, Accounts, Call History, Notification Center, Slack, Microsoft Teams and WhatsApp need Full Disk Access for ChatGPT, which macOS does not prompt for; when it is missing, setup reports those connectors as unavailable and a second form offers to open the Full Disk Access list in System Settings. Users do not install Node, Docker or a repository: the launcher runs the server on the Node runtime bundled with the desktop app. The terminal equivalent of steps 1–2 is `codex plugin marketplace add ezzabuzaid/context-compiler --ref release`. The post-install setup prompt requires Codex 0.156 or later.

`plugins/context-compiler` is the installable package; [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json) lists it. Codex copies the folder from a git ref and runs it as is, without installing or building anything, so its server is bundled into `plugins/context-compiler/server` from the shared `apps/server` build by `npx nx run plugin:bundle`: `main.mjs`, one folder per built-in connector, the chunks they share, and the EventKit helper. That folder is build output, ignored on main. `npx nx run plugin:marketplace` assembles the installable marketplace, `marketplace.json` and the built `plugins/context-compiler`, in `dist/plugin-marketplace`, which `codex plugin marketplace add` accepts as a local path. `npx nx run plugin:release` publishes that result to the `release` branch (see [Release](#release)).

The MCP tools only set up; the settings file's `selected_connectors` view lists each selected connector and where its import lives, relative to that folder. Each selection imports into `~/Library/Application Support/Context Compiler/Imports/<connector>/<selection>`: `data.sqlite`, where each stream loads into a `raw_<stream>` table read through a described view, beside the `catalog`, `sync_status`, `stream_status` and `extraction_coverage` views elt-sqlite publishes, plus checkpoints and managed attachment copies. The query skill reads each `data.sqlite` directly with `sqlite3 -readonly`; the Codex sandbox also denies writes there.

A plugin server imports a connector when the user connects it or changes what it imports, every connected connector again when the user presses Sync on the Context Compiler page, and one connector when the user picks Sync in its row's right-click menu. A connector the user keeps current, with the Keep current switch on its detail page (`connector_watch`), also loads each change while a chat or the Context Compiler page is open: every server stands by for its import, and the one that owns it watches it, so Sync of it runs no pass of its own. Nothing else refreshes or retries an import on its own, so an import no pass loaded completely, such as one Codex closed during or one a full disk cut short, waits for Sync. Setup returns once the answers are saved; a connector that has not finished its first import is reported as importing. Every pass is recorded in the connector's own file, so a reader judges freshness from the file it queries. A changed scope is a new import; the previous copy is removed.

After install, ChatGPT lists the Context Compiler page, an MCP App the server serves as `ui://context-compiler/page.html`, under the sidebar's Explore menu, where the user pins it. Its sidebar, drawn like ChatGPT's Space with the page's own title row (`header: { enabled: false }` on the entrypoint), holds Sync and lists Monitors and each connector with its status as a dot (the status line on hover), a right-click menu whose Sync imports that connector alone, and its switch, which asks before it deletes an import. The page reads them again while a sync or an import runs, and shows the connector the user opens; with none open, the main area is empty. A connector's detail page narrows it to accounts, collections, dates and attachments. ChatGPT's Settings search also finds the page by its connectors' names, through the page's `settings` entrypoint; the plugin has no native `openai/settings` section, since ChatGPT ignores a page's search terms while one exists. Chats link to the page as `codex://plugins/context-compiler/app/page`, and to one connector's page with `?path=%2Fconnectors%2F<connector>`; the hooks' status gives the agent both.

The setup skill can be run again to change or disconnect connectors. It accesses content already available on the Mac; Calendar keeps remote attachment links without requiring Google sign-in. Scoped Mail omits global settings and native metadata streams whose ownership cannot be established.

## CLI

[`apps/cli`](apps/cli/src/main.ts) reads the same connectors from a terminal. Use **Node.js 26** and npm on macOS; Calendar and Reminders require **macOS 27**, the release the EventKit helper is built for. The CLI runs from a checkout (see [Development](#development)). Plugin, desktop and CLI share `~/Library/Application Support/Context Compiler/Imports` by default: settings, imports, checkpoints and attachment files. Pass `--directory <path>` before the command to use a separate CLI store. Read the shared store with:

```sh
npx nx run cli:start -- status
```

Commands run with `npx nx run cli:start -- [--directory <path>] <command>`:

- `setup` asks which connectors to import and, optionally, which accounts, collections and dates to narrow each one to; `setup --connector notes --collection <id> --since 2025-01-01 --connector mail` does the same without prompts, each narrowing flag applying to the `--connector` before it and each date a `YYYY-MM-DD` day on this Mac's clock, and `options <connector>` lists the IDs. Changing a connector's selection removes its import, so the next sync loads it again; an import another sync is loading is removed by the next `setup` or `sync`.
- `sync` loads every selected connector once, showing each stream's progress; run it again, or use `sync watch`, to refresh. A sync that finds another sync loading a connector says so, waits for that pass and shows its outcome instead of loading it again; if that other sync is killed first, it shows the connector as interrupted and exits 1. `status` never keeps a sync from starting. Ctrl-C stops a sync at once with exit status 130; what it committed stays, and the next sync resumes it.
- `sync watch` keeps every selected connector current, or only those `--connector` names. It loads each one at once, then again each time its app's store changes, until Ctrl-C or SIGTERM stops it. A connector is current only as far as its app's store on this Mac: WhatsApp and Notes stop writing theirs while closed, Safari stops syncing history and iCloud Tabs while closed, Slack, Teams and Mail save theirs only now and then, and Wallet fetches passes from iCloud once a day, so their data is as of that last write or fetch. One process owns an import at a time: a second `sync watch` of it waits and takes over when the first stops, and a `sync` of it says the watch keeps it current and loads nothing. A `setup` that removes a watched connector stops its watch within a second or two, and the next `setup` or `sync` removes its import. A connector whose source stops reporting changes stops alone and says so. Watching Notes opens Notes hidden, because only Notes syncs iCloud notes.
- `status` lists every connector with separate Configuration (enabled or disabled) and Sync columns. Enabled connectors come first and show their latest pass, last success and database; disabled connectors have no sync state. With `--json`, `enabled` is a boolean and `state` is the sync state (`null` when disabled, `never` when enabled but not synced), with each stream's status too. A pass a killed sync left shows as running until the next sync.
- `query <connector> --tables` lists each stream's view, its rows and its declared coverage, and `query <connector> "<sql>"` runs one read-only statement. Each connector's `catalog` view lists every view and column with its description.

Each import's `<directory>/<connector>/<selection>/data.sqlite` holds `raw_<stream>` tables read through described views named after their streams (`inline_attachments` for `inlineAttachments`), with the sync history and `catalog` views elt-sqlite publishes. macOS grants access to the terminal app that runs the CLI, so it needs its own Full Disk Access, Contacts, Calendar and Reminders grants; a connector denied access fails alone and names the grant. Without a terminal, or with `--json`, output is JSON (one line per pass for `sync`) and nothing prompts.

Calendar reads occurrences from 2000-01-01 to a year ahead unless the selection narrows the dates, and its import downloads attachments stored in Google Drive and Gmail. That needs `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the workspace `.env` (a Desktop OAuth client with the Drive and Gmail APIs enabled); the first Calendar sync opens a browser for consent. Contacts account names (iCloud, Google) are not in its stores and do not load.

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

Audio transcription is off until you choose a model. On the Context Compiler page, open **Audio transcription**, enable it, choose a speech model installed on this Mac, and save. The page lists every model it finds through Spotlight and in the Hugging Face cache, whichever app or tool installed it; Cohere Transcribe Arabic transcribes Arabic and English speech. Audio stays on this Mac; existing and new imported attachments become searchable through `attachment_text`. Turning it off keeps existing transcripts.

The CLI saves the same choice in the shared store, or its `--directory` override:

```sh
npx nx run cli:start -- --transcription-model cohere-transcribe-arabic-07-2026-Q8_0.gguf sync --connector whatsapp
npx nx run cli:start -- --transcription-model off status
```

Local transcription decodes audio with macOS's `afconvert`, so it needs nothing installed. Building the native worker requires Rust/Cargo and CMake; Nx builds it automatically. Installed models are reused in place and are never modified.

## Permissions

Permissions apply to the process running the import: ChatGPT for the plugin, the terminal app for the CLI. A sandbox can still restrict access after permission is granted.

| Operation                    | Required access                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read or watch Apple Mail     | Full Disk Access (Mail's store and the system Accounts store, which holds account settings)                                                            |
| Read or watch Apple Notes    | Full Disk Access; Notes does not need to be open                                                                                                       |
| Read or watch Apple Contacts | Contacts access or Full Disk Access; Contacts does not need to be open                                                                                 |
| Read or watch Apple Safari   | Full Disk Access; Safari does not need to be open, but only Safari fetches history and tabs from other devices                                         |
| Read or watch Apple Books    | Full Disk Access; Books does not need to be open, and books kept only in iCloud are listed without their files                                         |
| Read or watch Mac activity   | Full Disk Access (Biome and knowledgeC); no app needs to be open                                                                                       |
| Read or watch Apple Accounts | Full Disk Access; no app needs to be open                                                                                                              |
| Read or watch Apple Clock    | Access to the protected database and city preferences, covered by Full Disk Access; stopwatch preferences were readable without that grant on macOS 27 |
| Read or watch Reminders      | Full Reminders access through EventKit                                                                                                                 |
| Read or watch Calendar       | Full Calendar access through EventKit                                                                                                                  |

Manage permissions in **System Settings → Privacy & Security**. Calendar and Reminders request access on the first native operation if it is undecided.

## Development

```text
packages/connectors/   One package per connector (connector-<source>), with
                       Connector (connector) and discovery
                       (connector-manifest)
packages/settings/     The selection and settings all hosts keep in settings.sqlite
apps/server/           Shared MCP server and its MCP page adapter (server)
apps/plugin/           Codex plugin packaging and release (plugin)
apps/desktop/          Electron shell and Vite React frontend (desktop)
packages/ui/           Shared React page, components, styles and tool result schemas (ui)
apps/cli/              Terminal CLI: setup, sync, status, query (cli)
plugins/context-compiler/ The installable plugin: manifest, skills, hooks, launcher
docs/                  Host behavior and verification notes
```

### Sibling checkout of elt

This repository uses the elt packages (`@workspace/elt`, `@workspace/elt-sqlite`, the sources, SDKs and codecs) from a checkout of [elt](https://github.com/ezzabuzaid/elt) beside it. They are not published. The root `package.json` lists `../elt/packages/*` and its sibling globs as npm workspaces. npm links each one into `node_modules` and leaves its dependencies to elt's own `node_modules`, so run `npm install` in elt too; the packages both repositories import (zod, `@zukhruf/sqlite-drift`, `@zukhruf/sqlite-transaction`, `ai`) keep the same versions on both sides. The `.npmrc` points the `@workspace` scope at an address nothing listens on, so npm fails on a package that is not linked instead of fetching a stranger's package of that name from the public registry (dependency confusion).

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

`typecheck` first runs the project's `lint` target (ESLint), which runs its `format` target (Prettier, which rewrites files and sorts imports) first. The pre-commit hook (`.husky/pre-commit.ts`, from `@zukhruf/git-hooks`) runs `nx sync`, stages only the files that sync wrote, and checks the staged copy of each file with Prettier. It does not lint or type-check, so run `npx nx run <project>:typecheck` for each project you change before you commit. Test targets build first and use Node's test runner.

The server's end-to-end tests (`apps/server/src/plugin.e2e.test.ts`) start the plugin server on the Node runtime that the ChatGPT desktop app keeps in `~/.cache/codex-runtimes`. When `CODEX_MCP_NODE_PATH` is set, they use that Node instead. Run `npx nx run plugin:test` on a Mac that has the ChatGPT app, with `CODEX_MCP_NODE_PATH` not set, so the tests run the plugin on the Node that users have. The MCP page test also uses an installed Google Chrome through Playwright.

Run apps only through their Nx targets: `start` builds the app and its packages first and loads the workspace `.env` (gitignored). Node's default TypeScript stripping does not support the parameter properties used here, so the targets run the built JavaScript. `npx nx run plugin:install` builds the marketplace and installs the plugin from it into this Mac's Codex (`codex plugin add context-compiler@context-compiler`).

### Release

The repository has no CI. `npx nx run plugin:release` builds `dist/plugin-marketplace` and publishes it to the `release` branch through GitHub's Git Database API, which Codex installs from. It runs `plugin:test` and `plugin:marketplace` first, publishes nothing when the branch already holds the same files, and needs `gh auth login`. Bump the version in `plugins/context-compiler/.codex-plugin/plugin.json` for each release, since ChatGPT keeps the page per plugin version.

### Adding a connector

Add the source in elt first, with elt's [add-elt-source skill](https://github.com/ezzabuzaid/elt/blob/main/.agents/skills/add-elt-source/SKILL.md). Then register its connector here with the [register-connector skill](.agents/skills/register-connector/SKILL.md). [Connectors and their hosts](docs/connectors-and-hosts.md) describes how the hosts discover, load and import connectors.

## Desktop and shared UI

`npx nx run desktop:start` builds and opens the Electron app. `npx nx run desktop:package` packages it; `npx nx run desktop:verify-package` checks the native package. The Vite entry is `apps/desktop/frontend/index.html`; its output is `apps/desktop/dist/renderer`.

`packages/ui` owns the existing page layout, components and interaction state. Its `./contract` export contains only the Zod result schemas, so the server can use it without loading React. Each host supplies the SDK's `callServerTool` interface. The MCP adapter in `apps/server/src/page/main.tsx` owns host styles, deep links and chat links; the desktop entry owns native theme updates, startup/retry state and the narrow preload connection. React is a peer dependency of the UI package.

`npx nx run server:bundle` produces `apps/server/dist/server`, including the self-contained MCP page resource and native helpers. Plugin packaging copies that output into the installable plugin; Electron packages the same output as a resource. Sync, watch and monitor orchestration live in `apps/server`; neither frontend implements them. The CLI continues to use the existing connector packages directly.

The desktop renderer has no Node access. Electron validates IPC senders and tool names, serves only its built frontend directory, and blocks remote requests, frames, injected scripts, navigation and browser permissions. React handles form submissions locally; the content security policy still prohibits document form navigation. Run `npx nx run desktop:test` for sync, settings, restart, cancellation and security scenarios, and `npx nx run server:test` for MCP behavior. `plugin:test` retains its existing entry point and runs the server suite.
