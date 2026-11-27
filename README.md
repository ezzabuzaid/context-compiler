# Context Compiler

The apps on a Mac keep your mail, chats, notes and calendar in their own stores, each with its own format. An agent cannot read them all. Context Compiler is a CLI that imports these stores into SQLite, one database for each connector, and keeps them current. An agent then reads the databases with `sqlite3 -readonly`. The data stays on the Mac.

A connector is the CLI's use of one [elt](https://github.com/ezzabuzaid/elt) source. elt is the ELT (extract, load, transform) library that reads each app and loads SQLite.

| Group  | Connectors                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple  | Mail, Messages, Notes, Calendar, Reminders, Contacts, Safari, Books, Clock, Wallet, Accounts, Call History, Notification Center, Mac activity |
| Chat   | Slack, Microsoft Teams, WhatsApp                                                                                                              |
| Browse | Dia, Google Chrome, Arc, Microsoft Edge                                                                                                       |
| Web    | Instagram profiles, OpenSooq listings                                                                                                         |

The README of each [elt source](https://github.com/ezzabuzaid/elt/tree/main/packages/sources) lists its streams, fields and limits.

## Start

You need macOS 27, Node.js 26 and a checkout of elt beside this repository.

```sh
git clone https://github.com/ezzabuzaid/elt.git
git clone https://github.com/ezzabuzaid/context-compiler.git
cd elt && npm install && npx nx run-many -t build && cd ..
cd context-compiler && npm install
npx nx run cli:start -- setup
npx nx run cli:start -- sync
```

The [CLI README](apps/cli/README.md) lists the commands.

## Permissions

macOS gives access to the program that reads, which is the terminal app that runs the CLI. Give it access in **System Settings › Privacy & Security**. A connector without access fails alone and names the grant.

| Connector                               | Access                          | Is the app necessary?                                                                       |
| --------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| Mail                                    | Full Disk Access                | No. Only Mail downloads new messages and missing content.                                   |
| Notes                                   | Full Disk Access                | No. Only Notes completes the iCloud sync.                                                   |
| Safari                                  | Full Disk Access                | No. Only Safari gets history and tabs from other devices.                                   |
| Books                                   | Full Disk Access                | No. Books that are only in iCloud load without their files.                                 |
| Messages                                | Full Disk Access                | No. Only messages that are on this Mac load.                                                |
| Call History                            | Full Disk Access                | No. One store holds the calls of Phone, FaceTime and the iPhone.                            |
| Notification Center                     | Full Disk Access                | No. Only the notifications that Notification Center still holds load.                       |
| Clock, Accounts, Mac activity           | Full Disk Access                | No.                                                                                         |
| Contacts                                | Contacts or Full Disk Access    | No.                                                                                         |
| Calendar, Reminders                     | Full access, through EventKit   | No. macOS asks at the first read.                                                           |
| Slack                                   | Full Disk Access                | Yes. Open each workspace. Slack saves what it loaded about once an hour, and when it hides. |
| Microsoft Teams                         | Full Disk Access                | Yes. Sign in. Only what Teams loaded on this Mac loads.                                     |
| WhatsApp                                | Full Disk Access                | Yes. WhatsApp saves new messages only while it runs.                                        |
| Dia, Google Chrome, Arc, Microsoft Edge | None                            | No.                                                                                         |
| Wallet                                  | None                            | No. Passes that iCloud brings from the iPhone load too.                                     |
| Instagram                               | Safe Storage key of the browser | Sign in to Instagram in a Chromium browser. Click Always Allow when macOS asks.             |

## Development

```text
apps/cli/              The CLI
apps/                  Other pipelines and agents on elt (ambient, ipay, startup-credits, …)
packages/connectors/   One package for each connector, with Connector and its discovery
packages/settings/     The selection that the CLI keeps in settings.sqlite
docs/                  How the CLI loads connectors and runs imports
```

The root `package.json` links every elt package from `../elt` as an npm workspace. It does not take the published `@eltjs` packages from npm: a linked source loads elt's own copy of `@eltjs/elt`, and a `Stream` of one copy is not a `Stream` of the other. Build elt again after you change it.

Run each app through its Nx target. `start` builds the app first and loads the `.env` file of the workspace.

```sh
npx nx run-many -t typecheck   # format, lint, then type-check
npx nx run-many -t test
```

To add a connector, write its source in elt with elt's [add-elt-source skill](https://github.com/ezzabuzaid/elt/blob/main/.agents/skills/add-elt-source/SKILL.md). Then register it here with the [register-connector skill](.agents/skills/register-connector/SKILL.md). [Connectors and their hosts](docs/connectors-and-hosts.md) tells how the CLI finds, loads and imports connectors.
