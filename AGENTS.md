# Agent rules

## Work in the one checkout

Every session shares this checkout. Do not make a git worktree, a `git clone`, an exported tree or any other copy of the repository, not even to gate a commit or run a live check. Build and test here. To commit only your part of a shared file, stage your hunks with `git apply --cached`, read each staged hunk where it landed with `git diff --cached -U3`, and after committing check `git show --stat HEAD`. When a peer's unfinished work breaks a test, ask that peer; do not copy the tree to get around it.

The pre-commit hook (`.husky/pre-commit.ts`) runs `nx sync` and checks the format of the staged files. It does not lint or type-check. Run `npx nx run <project>:typecheck` for each project you changed before you commit. That target formats, lints and type-checks the project.

## The library lives in elt

Sources, SDKs, codecs, destinations and elt itself live in [ezzabuzaid/elt](https://github.com/ezzabuzaid/elt). Check it out at `../elt`. This repository uses its packages through the npm workspaces in the root `package.json`.

- Connectors exist to find elt gaps. When a connector needs a capability that elt does not have, fix the gap in elt. Do not work around it in the connector or the host.
- A change that spans both repositories is two commits. Commit elt first, then this repository.
- Build elt again after you change it (`npx nx run-many -t build` in `../elt`).
- Connector packages in `packages/connectors` are not islands. They describe and import the user's Mac apps, and `Connector` writes to the import store.
- In this repository, "app" means only the real macOS application. The things that users set up, select and import through are connectors. Tool arguments, CLI flags and stored names say connector.

## Stored data is disposable

Every import and checkpoint can be rebuilt by rerunning the pipeline from scratch. Treat that data as cheap.

- Never design around data that is already stored: no backward-compatible schemas, no keeping checkpoint bindings stable, no migration paths, no compatibility shims or defaults left `undefined` for old state.
- Change schemas, identities, bindings, and defaults whenever the design improves; the fix for old output is a fresh run.
- A value that code derives and stores, such as an import folder path in `settings.sqlite`, is old output too when the derivation changes. Do not rewrite stored values into the new form, not even as a consistency check that runs on every open: that is a migration. `Settings.#follow` went this way.
- Do not document migrations between connector versions. Document the current behavior only.

## Separate the concept from the mechanism

When asked why a notion exists, name the requirement it serves, not the code that currently needs it. A line such as `DELETE FROM` shows how a writer overreaches today; it does not make the mode, flag, or field that triggers it a necessary concept. Before relocating or keeping a notion, check whether it is an input to a smaller notion that is the real one.

Before defending a package mechanism, list each consumer with its file and line and say whether it decides something or only displays it. Display text in a host does not justify a lock or a liveness check in a package; a consumer that decides does, until a probe shows another owner can decide it. `SQLitePasses`, once in elt's SQLite destination, went this way: its pass lock fed three status strings in these hosts and one folder guard, and only the guard, moved onto the import's flight, was a requirement.

Before you move, extract or wrap a guard such as a lock, name the failure it prevents as a concrete case with the hosts' real configuration, and say who else prevents it. If no host can cause the case, delete the guard; do not find it a new home.

## Exhaust live verification before calling something unverified

When a live probe finds no instance of a feature, widen it before concluding: scan the full history, not a sample window, and use any earlier evidence that the data exists. Mark behavior unverified only when the environment genuinely cannot produce it, and say what blocked it.

Drive the app yourself before listing manual steps: open URLs, click menus and rows through System Events, and post real mouse events (Quartz `CGEventPost`) where accessibility clicks do not land, as in SwiftUI lists. Hand the user only what macOS reserves for them, such as a privacy prompt, and then as one step.

While the user is at the machine, act without taking it over. Accessibility actions, row selection and row custom actions reach a background app without focus or the pointer. Only a context menu needs the app frontmost; bring it forward for a second or two after the input has been idle, then give focus back to the app the user was in. Never post a real click unless the target app is frontmost.

## Remove before you add

When the user says a mechanism should not exist, remove it before you build any feature that touches it. Do not extend it to carry the new feature, not even by one parameter. Before you add anything, ask whether it should exist at all: name the requirement it serves and who already serves it. The Context Compiler page's Sync button went this way: it was first built as a second caller of `importPending`, after the user had said that function should not exist.

## Remove a mechanism through its problem class

When the user asks how to get rid of a mechanism, name the problem class it answers and how software engineering solves that class, with a precedent you read in a textbook or a vendor's source. Then show where the codebase already does it. Do not move the mechanism or compute it in a new way: a derived copy of the same mechanism is not a removal. `storeLayout` went this way: a hash of the DDL in place of the hand-bumped number kept a version stamp, but data that a rerun rebuilds needs no version. The fix compares the stored shape with the declared shape through a `Declaration` (`@zukhruf/sqlite-drift`).

## Restate the user's example before designing

When the user names a capability, take its simplest literal reading and restate it as "when X, then Y" with the user's own example before you propose a mechanism. elt's eca actions went this way: a design of rungs, typed proposals and host allowlists answered a question nobody asked. The user meant that an action is an instruction to an agent: when "I ordered food", run `codex "log my calorie intake from the food I ordered"`.

## Build the API shape the plan names

Build the command, tool or API the approved plan names, in that shape. Avoiding a copy is no reason to change it: the Rule of Three accepts a second copy, recorded in a ledger. When a different shape seems better, ask before building it. The CLI's `people` command went this way: the plan named a standalone `people` command, it was first folded into `query people` to avoid copying `query`'s 25-line statement runner, and the user moved it back beside `query`.

## Name the standard term

When you tell the user about a problem or a design, name the standard software-engineering term for it, define it once in one line with a well-known example, and then use it. Do this in every message, status notes included, not only in proposals: the user reads to learn as well as to decide. The parse-concurrency research went this way: "one slow parse holds up the rows behind it" is head-of-line blocking, "the file is valid until the next pull" is a lending iterator, "read ahead" is prefetching, and "a file handle elt closes" is ownership transfer of a disposable resource.

## Place each job with whoever can know it

Before proposing where a fix lives, split the requirement into its jobs and name, for each, who can actually know it: the source, the elt engine, the destination, the connector, the plugin server, or the agent. A job belongs to that owner. A slow Mail answer, for example, split into three jobs: whether a message changed (only the Mail source in elt knows), turning changes into upserts and deletions (a shared elt helper the source calls), and when to refresh (the source's `observe()`, run by the plugin server, not a skill telling the agent to sync).

## Follow the vendor's own current source, not only its docs

When asked for a platform's latest format or practice, read what the vendor's newest code actually ships (for Codex plugins, `openai/plugins` at `main` and the plugins cached under `~/.codex/plugins/cache`) before recommending anything. When the docs and the source disagree, show both, cite commits, and follow the source.

## Let packages own plumbing; let classes own behavior

Before writing argv routing, help text, usage errors, prompts or terminal rendering, search the installed package and its authors' siblings for it. In `apps/cli`, commander routes and validates, and clack prompts and renders. When a package takes over a job, such as clack exiting on Ctrl-C while its spinner runs, adapt to how it behaves rather than working around it.

Before proposing a package or an API, list the installed package's whole export surface, renamed exports such as `decide as experimental_decide` included, and read its vendor's current source for providers. A grep for the names you expect is not that list. The decision-model API went this way: a `@zukhruf/decisions` package was proposed while AI SDK 7 already shipped `experimental_decide`, and its official `@ai-sdk/typesafe-ai` provider already spoke llama.cpp's `/v1/systemone`.

Model a set of things that share an algorithm as a template class: an abstract base owns the fixed steps, and each variant is its own small class in its own file (`apps/cli/src/commands/`, the connectors in `packages/connectors/` over `Connector`). Do not use a definitions table imported everywhere and indexed by name. Callers ask an object; they do not reach into a registry.

## Fake only what cannot run for real

Test against the real dependency: a real `Pipeline`, real SQLite, a synthetic app database on disk. A test that needs data in a live store writes it there and deletes it, as the EventKit tests do with a temporary calendar. Fake a boundary only when the real one cannot produce the case, say why beside the fake, and make the fake a real stand-in outside the code under test, never a mock of a module: `StubEventKitHelper` (from elt's `@workspace/sdk-apple-eventkit/test`) is an executable the EventKit stores run instead of the compiled helper, because EventKit cannot create attendees and a test cannot deny access or remove the ICS export. A package that owns such a boundary exports its fake as a class under a `./test` subpath. Every other test helper lives in the test file that uses it; packages export no shared testing modules.

## Read every changed file before reporting done

Before calling a change finished, read each file it touched in full, not from memory, and remove what has no single concept or real consumer: forwarding wrappers, conversions of values whose types are known, defaults nobody overrides, exports nobody imports, and files left over from a split. Probe any claim that something cannot work before relying on it. Do this unprompted; the user should not have to audit file by file.
