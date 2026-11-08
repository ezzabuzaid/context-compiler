# Apple test fixtures copied from elt

A test of an Apple connector writes a small copy of the app's store on disk. The elt tests in `~/Desktop/experiments/elt` need the same stores, and they are the source of these fixtures, because elt owns the code that reads the stores. The two repos are different repos and a package exports no test support, so the fixtures stay copied.

Mirror every fix in each copy and name each file in the commit. The ledger in elt is `docs/copied-apple-test-fixtures.md`, and it lists the same copies.

Paths on the left are in elt. Paths on the right are in this repo.

## NoteStore

`packages/sources/apple/notes/src/notes.test.ts` → `apps/cli/src/cli.e2e.test.ts` and `apps/server/src/plugin.e2e.test.ts`.

Copied without changes: `noteStoreSchema`, `noteEntities`, `noteTable`, `protobuf`, `NoteRun`, `noteBody` and `richNote`.

Copied with changes: `noteStoreFixture`.

- Both copies call `openDatabase` in place of `open`. Why: in `plugin.e2e.test.ts`, `open` is the function of `node:fs/promises`.
- `cli.e2e.test.ts` calls `appleSeconds` in place of `coreDataSeconds`. Why: its Safari fixture already defines that function.

## Safari

`packages/sources/apple/safari/src/safari.test.ts` → `apps/cli/src/cli.e2e.test.ts`.

Copied without changes: `writePlist`, `binaryPlist`, `escapeXml`, `xml`, `appleSeconds`, `int32s`, `bookmarksPlist`, `closedTabsPlist`, `historySchema`, `tabsSchema`, `cloudTabsSchema` and `archived`.

Copied with changes:

- `safariFixture` and `tabsFixture` call `openDatabase` in place of `open`.
- `safariFixture` in elt also writes `HistoryAgeInDaysLimit` to Safari's preferences, so its fixed visit dates do not expire. The copy does not write it.

## Knowledge and Biome

`packages/sources/apple/activity/src/activity.test.ts` → `packages/connectors/activity/src/activity-presets.test.ts`.

Copied without changes: `knowledgeSchema` and `devicesSchema`.

Copied with changes: `protobuf` and `Field`. The copy has no `bytes` and no `message` field. Why: its records hold numbers and strings only.

## Messages

`packages/sources/apple/messages/src/messages-source.test.ts` → `apps/ipay/src/ipay.test.ts`.

Copied without changes: `chatSchema`.

Copied with changes: `appleNanoseconds`. The copy writes `Date.UTC(2001, 0, 1)`. The elt test takes the epoch from `@workspace/codec-apple-reference-date`.

## Mail

`packages/sources/apple/mail/src/mail.test.ts` → `apps/ipay/src/ipay.test.ts` and `packages/connectors/mail/src/mail-presets.test.ts`.

Copied with changes: `schema`, with the same text, is `envelopeIndexSchema` in both copies. The name says which store it describes, because `ipay.test.ts` also has `chatSchema`.

Not a copy: `mime`. In elt it is one fixed message. In `ipay.test.ts` it is a function that builds each email of the test.
