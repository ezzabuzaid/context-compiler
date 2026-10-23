# Code copied from the CLI

The Context Compiler server and the CLI both let one process at a time load an import, and both remove an import the selection no longer names. The server keeps its own copy of that code, separate from `apps/cli`.

The Rule of Three counts implementations, not launchers. Codex starts the MCP server in `apps/plugin/src/main.ts`. Any other launcher of this server adds no third copy, so backlog #2555 stays at strike 2. Shared code is extracted when a third implementation needs it. Until then, a fix in one copy is made in the other copy too, and the commit names both files.

Paths on the left are in `apps/cli/src`. Paths on the right are in `apps/plugin/src`.

## Copied without changes

**`imports.ts` `owners()` → `plugin.ts` `owners()`.**
The import's owner claim: a `SqliteElection` whose claim and epoch files sit at the store's root, named after the import's folder.

## Copied with changes

**`imports.ts` `removeStale()` → `plugin.ts` `Plugin.#removeStale()`.**
Both remove a stale import only in its flight and only while they own it.

- The plugin's flight carries no lines, so its callback returns nothing.

Why: a plugin pass reports its outcome through the import's sync history, not through lines that a waiting sync shows.

## Not a copy

The CLI's `Imports.watch()` and the plugin's `Plugin.watch()` both campaign for an import and then watch it, but they answer different needs. The CLI watches the connectors that one command names until the user stops it. The plugin follows the settings each second for the connectors the user keeps current, and gives an import up when the user switches it off or when another plugin version replaced its own.
