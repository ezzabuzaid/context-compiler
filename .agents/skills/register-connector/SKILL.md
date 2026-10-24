---
name: register-connector
description: Registers a built-in connector in context-compiler, so that the CLI and the Codex plugin load a source from elt. Use when a new source exists in elt and the hosts must offer it, when you change what a connector can be narrowed by, its permission guidance or its presets, or when the request says "add X to the plugin" or "make the CLI import X". The source itself is written in elt first, with elt's add-elt-source skill.
---

# Register a connector

Paths are relative to the repository root. The _source_ is the elt package that reads the app (`@workspace/source-<platform>-<name>`, such as `source-apple-mail` or `source-slack-desktop`). The _connector_ is the hosts' use of it: a package in `packages/connectors/<name>` that both hosts load.

## What you need to know

- Write the source in elt first. Use elt's add-elt-source skill in `../elt`. Build elt (`npx nx run-many -t build` in `../elt`). A capability the connector needs and elt lacks is an elt gap. Fix it in elt. Commit elt before this repository.
- A connector package is `packages/connectors/<name>`. Its package name is `@workspace/connector-<source>` and its Nx project is `connector-<source>`, where `<source>` is its elt source's name without `source-`: `source-apple-mail` gives `connector-apple-mail`, and `source-slack-desktop` gives `connector-slack-desktop`. The folder `<name>` is the app's short name. It is not an island, because `Connector` writes to the import store.
- The entry is `src/<name>-connector.ts`. Its default export is the `Connector` subclass. It imports its source from the source package. It declares what the connector can be narrowed by (`choices`, from `@workspace/connector/choice`), its permission guidance (`access()`, `fullDiskAccess`) and how it loads (`source(scope)`).
- `package.json` is the manifest. It has `"type": "module"`, `"exports": "./dist/<name>-connector.js"` and a `contextCompiler` field with the connector's `name` and `title`. The class does not declare the name or the title.
- What the hosts share is in `packages/connectors`: `Connector` in `connector`, and discovery and the host modules in `connector-manifest`. `apps/` holds no libraries.
- A connector package exports only its entry: the `exports` string names that one file. Other packages export each public module as an explicit subpath (`@workspace/connector/connector`), never a barrel.
- `Connectors` in `packages/connectors/manifest` discovers every connector folder. The CLI reads `packages/connectors`. The plugin bundle ships each built-in connector as its own folder beside the server. Nothing lists connectors by name.
- A connector's presets are SQL files in `packages/connectors/<name>/presets`. Each `presets/<view>.sql` holds one `CREATE TEMP VIEW <view>`, after `-- <view>: …` and `-- <column>: …` comment lines. The bundle copies them.
- A connector outside the repository goes in `~/Library/Application Support/Context Compiler/Connectors/<name>/`. Its `package.json` names a `.ts` entry. The entry is strip-only TypeScript. It imports only Node built-ins and the host modules in `packages/connectors/manifest/src/host-modules.ts`. The model is `packages/connectors/manifest/src/fixtures/photos`. The plugin's `$add-connector` skill tells the agent how to write one for a user.
- Each import loads `raw_<stream>` tables into its own `data.sqlite`, read through `<snake_stream>` views. See [Connectors and their hosts](../../../docs/connectors-and-hosts.md).

## Steps

1. Copy `packages/connectors/notes` to `packages/connectors/<name>`. Keep its `project.json` and `tsconfig.json` shape.
2. Set the names in `package.json` and `project.json`. Set `contextCompiler.name` and `contextCompiler.title`.
3. Replace the dependencies in `package.json` with the source package and the other packages the entry imports.
4. Write `src/<name>-connector.ts`. Start from the connector whose app is most similar.
5. Add `@workspace/connector-<source>` to the dependencies of `apps/cli/package.json` and `apps/server/package.json`. Nx then builds it before both hosts.
6. Run `npm install`. Nx keeps the TypeScript project references current itself (`sync.applyChanges` in `nx.json`).
7. Add the connector's row to the permissions table in `README.md` when it needs a grant. Describe host behavior in `docs/connectors-and-hosts.md` only when this connector changes it. Stream details go in elt's `docs/reference.md`.
8. Run `npx nx run connector-<source>:typecheck`, `npx nx run cli:typecheck` and `npx nx run server:typecheck`.
9. Run `npx nx run connector-manifest:test`, `npx nx run cli:test` and `npx nx run server:test`.

## Gotchas

- **The package is not a dependency of both hosts.** Nx does not build it before the host that lacks it. The CLI or the bundle then misses the connector, or loads a stale build. Add it to `apps/cli` and `apps/server`.
- **The class declares its name or title.** The manifest owns both. Take them out of the class.
- **The `exports` field is an object or names more than the entry.** Discovery reads one entry string. Name only `./dist/<name>-connector.js`.
- **The connector works around an elt gap.** The next connector meets the same gap. Fix it in elt and commit there first.
- **The connector repeats source logic** (streams, schemas, store paths, change signals). That belongs to the source or its SDK in elt. The connector holds titles, choices, permission guidance and settings wiring only.
- **A preset answers one question.** A preset is the source's data in a shape readers ask for. Write the question as a query over the preset instead.

## Done when

- `npx nx run cli:start -- setup --connector <name>` and `npx nx run cli:start -- sync --connector <name>` import the real app's data on this Mac. Inspect the import with `npx nx run cli:start -- query <name> --tables` and one `query <name> "<sql>"`.
- A second `sync` with no changes in the app behaves as the source's sync strategy promises: a snapshot stream writes nothing.
- `npx nx run plugin:install` installs a plugin that lists the connector, and setup through the plugin imports it.
- Typecheck and tests pass for the connector, `connector-manifest`, `cli` and `server`.
- Each gotcha above is checked against the diff.
- The elt change, if any, is committed in elt before the commit here.
