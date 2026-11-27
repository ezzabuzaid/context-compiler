# Context Compiler CLI

The CLI imports the apps on this Mac into SQLite and keeps the imports current. You select the connectors one time with `setup`. Then `sync` loads them, and an agent reads the result with `sqlite3 -readonly`.

```sh
npx nx run cli:start -- [--directory <path>] <command>
```

| Command                               | What it does                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `setup`                               | Selects the connectors. Flags narrow each one to accounts, collections or dates.    |
| `options <connector>`                 | Lists the account and collection IDs for the narrowing flags.                       |
| `sync`                                | Loads each selected connector one time. Ctrl-C stops it, and the next sync resumes. |
| `sync watch`                          | Loads again each time the store of an app changes, until you stop it.               |
| `sync watch start`, `restart`, `stop` | Runs `sync watch` in the background as a launchd job of your user.                  |
| `status`                              | Shows each connector, whether it is enabled, and its last sync.                     |
| `query <connector> "<sql>"`           | Runs one read-only SQL statement. `--tables` lists the views.                       |

`--json` prints JSON and never prompts. `--help` gives the flags of each command.

## Where the data goes

The store is `~/Library/Application Support/Context Compiler/Imports`. `--directory <path>` selects a different store. Each import is one `data.sqlite`, with one view for each stream and a `catalog` view that describes each column.

## Things to know

- The background job runs `node`, so macOS gives access to `node` and not to the terminal. `sync watch start` prints the `node` path. Add it to Full Disk Access, then run `sync watch restart`.
- Calendar downloads attachments from Google Drive and Gmail. For that, save a Google OAuth client of the type Desktop app as `~/.config/context-compiler/client_secret.json`. The first Calendar sync opens a browser for consent.
- `--transcription-model <file>` turns on audio transcription with a speech model that is on this Mac. `off` turns it off. The text of audio goes into the `attachment_text` view.

The [root README](../../README.md#permissions) lists the access that each connector needs.
