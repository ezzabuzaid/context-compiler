# WhatsApp row-version investigation (#2909)

Native investigation on 2026-10-23; production implementation benchmarked on
2026-10-24. The native app was WhatsApp 26.40.77 (1088046289), Node
v26.10.0, and an Apple M4 Pro with 48 GiB RAM. The production library was
`../elt` at `692ea80c8c77d81ae487380951e6e8dbb4400e3a`; its existing unrelated
working-tree changes did not touch the WhatsApp or snapshot-differential code.
The installed `@zukhruf/snapshot-differential` version was 0.3.28.

When a new WhatsApp message arrives, import that message; when an existing
message is edited, deleted, reacted to or acknowledged, update its affected
records. **Snapshot reconciliation** compares the current state with the last
committed state, as a directory synchronizer compares file listings. A compact
scan can make that comparison cheaper, but still visits every message key.

The production implementation reduces median warm unchanged extraction and
comparison from **6.867 s to 1.949 s (3.52 times faster)**. It uses the existing
elt grouped snapshot helper, reads compact metadata for every message, and
fetches full payloads only for changed groups. The SDK and source own this
once for every host. There is no WhatsApp-owned schema change or new dependency.

Native edits, reaction changes and receipt changes advanced the appropriate
row versions. A message-only version is insufficient. Hard deletion is
discovered by a missing key, not a new version. The controlled observations
below do not establish a public version contract: Apple describes Core Data's
SQLite format as private in its
[persistent store documentation](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/CoreData/PersistentStoreFeatures.html).

## Live verification

The probes read all 15 `ZWA*` tables in a read transaction, hashing every column
except `Z_OPT` and comparing complete primary-key sets. This covered the full
history, not a recent-message window. A content change with an unchanged
version would have been reported separately. None was observed across these
samples. Controlled mutations were made through WhatsApp in the account's
self-chat, using two disposable CC2909 messages. Both were deleted afterward
with the user's confirmation; no other chat received a test message.

| Native action                             | Message `Z_OPT` | Message-info `Z_OPT` | Result                                                       |
| ----------------------------------------- | --------------- | -------------------- | ------------------------------------------------------------ |
| Edit test message                         | 4 → 5           | 2 → 5                | Text changed; media version also advanced 1 → 2.             |
| Add 👍                                    | 5 → 5           | 5 → 8                | Message-only fingerprint would miss it.                      |
| Replace with ❤️                           | 5 → 5           | 8 → 11               | Message-only fingerprint would miss it.                      |
| Withdraw reaction                         | 5 → 5           | 11 → 14              | Outgoing reaction's emoji became absent.                     |
| Receipt update on second test message     | 2 → 2           | 1 → 2                | Delivered/read/played fields changed from null together.     |
| Independent real recipient's read receipt | 4 → 4           | 64 → 65              | Read timestamp changed without a message-row version change. |
| Delete first test message for me          | Row absent      | Row absent           | Message 74244, media 71497 and info 37152 disappeared.       |
| Delete second test message for me         | Row absent      | Row absent           | Message 74245, media 71498 and info 37153 disappeared.       |

The second receipt test sampled at 10 ms intervals. At 20:12:00.045 UTC its
message/info versions were 2/1 with null receipt timestamps; at 20:12:00.067
they were 2/2 with populated timestamps. A text message to oneself also gets a
`playedAt` value, so this is **not** proof of an independent voice-play receipt.
The separate real recipient's read transition avoids relying entirely on
self-chat behavior.

Deletion was also checked through the real `diffSnapshot` and
`diffGroupedSnapshot` implementations. A checkpoint seeded from the second
message before deletion was reopened in a fresh process. After WhatsApp
committed the deletion, both methods emitted exactly one message deletion and
one receipt deletion, with no upserts. There were no reactions/counts on that
message. Immediately after the bubble disappeared, the database briefly still
contained its rows; a later read confirmed the native commit. No SQL writes
were made to WhatsApp's database.

Version changes can be false positives for content changes: 12 media rows
advanced their versions while their other-column hashes remained identical.
An initial benchmark that opened new snapshots between trials detected this
maintenance and stopped. The final benchmark pins each database reader's
snapshot for the duration of its run.

### Decoder defect found: #2910

The live outgoing reactions occupied receipt-info protobuf field **7.2**.
The decoder previously read **7.1** and channel counts from **7.3**, so its
reaction output stayed empty while the UI showed the test reaction. That
separate fix preceded this optimization. Its real-pipeline regression for
outgoing add/replace/withdraw and duplicate prevention also passes through
the compact path.

### Limits of the evidence

- Self-chat offered only Delete for me. Delete for everyone and automatic
  expiry were not reproduced in this controlled test. The earlier full-history
  investigation found 416 type-14 revoked records and positive expiry logs,
  but those do not supply before/after row-version pairs.
- A real read receipt was observed. Independent third-party delivery and
  voice-play acknowledgements were not separately controlled. Historical
  played receipts exist; their presence alone does not prove a version change.
- Native-app restart, prolonged offline changes, native database replacement
  and native channel-count changes were not exercised. Synthetic database
  replacement, pipeline reopening and channel-count changes are now covered
  by regression tests; those do not prove every native write path.
- Current joined values were audited against the SDK query. Every possible
  native mutation of those relationships was not reproduced.
- Keep #2909 open for the remaining native transition evidence. The source
  optimization is implemented; end-to-end import timing and checkpoint
  persistence costs remain outside the benchmark below.

## Production implementation

The SDK's `ChatStorageSnapshot.messageInputs()` streams message keys and the
physical IDs/versions of the message, media and info rows, plus the actual
joined member JID, parent stanza ID, message date and local-media availability.
It hashes those inputs with the Core Data store UUID and physical file identity.
Replacing a store therefore invalidates reuse even if a restored copy repeats
its UUID, row IDs and versions. Missing required row versions fail the scan.
Whole chat versions are excluded: an unread-count change does not alter every
message. A chat-key change is included through the actual key.

`WhatsAppMessageStream` follows the existing Mail source pattern. Each physical
message is a group for the messages, receipts, reactions and reaction-count
streams. The existing `diffGroupedSnapshot` reuses unchanged groups and compares
changed records, so version-only changes do not produce output and vanished
keys produce deletions. Scope and first-duplicate selection precede grouping.
Metadata and targeted payload reads use the same pinned SQLite snapshot.

The first import streams the full join once per stream. Subsequent imports
fetch changed physical IDs. There is no shared array of all metadata or payloads;
the existing 60,000-message regression still runs within a 64 MB V8 heap. That
fixture took 6.41 s after this change versus about 3.7 s at baseline: seeding the
extra group state costs time. This optimization targets subsequent imports.

| Job                                                       | Owner                             |
| --------------------------------------------------------- | --------------------------------- |
| Native versions, joins, store identity and targeted reads | WhatsApp SDK in elt               |
| Stream projections, scope and dependency groups           | WhatsApp source in elt            |
| Reuse, record comparison and deletions                    | Existing elt snapshot helpers     |
| Records and checkpoint persistence                        | Existing pipeline and destination |
| Scheduling                                                | Existing host lifecycle           |

## Regression evidence

Tests use synthetic WhatsApp databases on disk, the real source, real `Pipeline`
and SQLite destination/checkpoints. No modules are mocked.

- The first compact-state test failed before implementation: no groups were
  saved. It now preserves groups across reopened pipelines and changes only
  one group's fingerprint after editing one message.
- Store replacement tests failed with repeated IDs/versions, including a
  restored file with the same UUID. Store and file identity now force rereads.
- Independent delivered/read/played fields, channel-count updates/removal,
  media-only changes, joined member/parent/chat changes, duplicate promotion,
  local-file disappearance/reappearance, revoke and hard deletion are covered.
- Scope changes and version-only changes preserve the previous output contract.
- Decode failures keep the last checkpoint and retry the failed version.
  Missing-version cases failed before validation was added and now fail safely.
- The existing small-heap regression caught an oversized raw fingerprint. A
  fixed-size SHA-256 fingerprint and streaming first import restored the pass.

Validation: source tests **34/34**, SDK tests **2/2**, both Nx typechecks, and
all **65 elt project builds** passed. The all-project build used `--skipSync`
after unrelated concurrent project-reference changes blocked Nx's sync check;
no unrelated references were rewritten.

## Benchmark

[Production aggregate results](probes/whatsapp-compact-production-results.json)
cover 74,053 messages, 217,562 receipts, 17,301 reactions and zero channel-count
records. Each mode runs in a fresh Node process, seeds its state, performs one
warmup and five measured passes, and invokes GC outside timing. The full mode
runs the full readers with `diffSnapshot`; compact runs the production stream's
`changes()` path. Each reader snapshot stays fixed for the run.

| Measurement                           |    Full payload scan | Production compact scan |
| ------------------------------------- | -------------------: | ----------------------: |
| Median of five measured passes        |          6,867.09 ms |             1,948.73 ms |
| Minimum–maximum                       | 6,642.66–9,857.32 ms |    1,874.10–2,062.48 ms |
| Checkpoint JSON across streams        |     39,755,689 bytes |        64,480,172 bytes |
| Upserts / deletions per measured pass |                0 / 0 |                   0 / 0 |

Warm scan duration is **71.62% lower**; checkpoint JSON is **1.62 times larger**.
This measures extraction and comparison, excluding checkpoint JSON
parsing/serialization, destination writes and attachment processing. It does
not measure the whole-store unchanged shortcut or end-to-end import latency.
The metadata scan remains O(N), including filesystem availability checks.
Checkpoint representation remains the separate follow-up #2781.

The earlier [prototype results](probes/whatsapp-row-version-results.json)
measured 7.086 s to 1.050 s with a shared in-memory metadata array and an
83.49 MB checkpoint. They are retained as investigation evidence, not the
production performance claim. Production streams metadata per stream to
preserve bounded memory, which explains part of the difference.

The temporary read-only benchmark script was removed after recording these
results. It imported the four built stream classes and one `WhatsAppScan`,
created incremental `CopyConfiguration` objects, then consumed either
`diffSnapshot(configuration, reader.read(scan), state, { policy: new ClosedWorld() })`
or `reader.changes(configuration, scan, state, undefined)`. It timed each pass
with `performance.now()` and saved the final state's JSON byte count outside
timing. The scope was unrestricted. No native or imported data was written.

## Removal audit

Removed: repeated full-payload reconciliation for unchanged message groups,
three full-store receipt/reaction helpers and their decoder walk, and the
temporary benchmark probe after retaining its aggregate evidence. The retained full reader
serves first imports, full refreshes and the benchmark baseline.

Net delta in elt, excluding the earlier #2910 fix: production **+255 / −86**
lines (including the new 81-line stream class), tests **+409 / −8**; net **+570**.
This is additive because it adds native dependency tracking and regression
coverage while reusing the existing differential. Research documentation and
aggregate measurements are retained separately; the temporary probe is removed.

Retained: output schemas, projection logic, first-duplicate behavior, scope,
file export, status retention, watchers and existing snapshot/pipeline semantics.

Rejected: a new CDC/WAL engine (no complete native feed), shared payload cache
(breaks the small-heap constraint), host-specific logic (the source owns it),
checkpoint compatibility shims (import output is disposable), and new package
dependencies (the installed packages already provide the required behavior).

Discovery: `@workspace/elt` publicly exports `diffSnapshot` and
`diffGroupedSnapshot`; `@zukhruf/snapshot-differential` 0.3.28 exports
`SnapshotGroup`, `GroupedSnapshotState`, `ClosedWorld` and `Retention`.
`@zukhruf/sqlite-snapshot` 0.3.31 provides `Snapshot.iterate`, `all` and
`requireColumns`. The shipped runtimes were read for unchanged-group callbacks,
closed-world deletion and snapshot pinning. Debug/env hooks for this boundary
were searched and absent. No applicable package API was rejected.

Radius: four message-derived streams changed; two scoped membership lookups
now use compact inputs. No host consumer changed. The three former derived
full-store reader methods and their private decoder walk have no remaining
call sites. Commit `57706179` established the streaming memory constraint;
that constraint is retained, with the 64 MB regression executed.

Self-audit: removed the new point-read forwarding wrapper, unused reader
interface methods and duplicate test initialization. The optional physical ID
selects full versus targeted reads; the optional first-load iterator avoids
per-message queries during seeding. Neither is a compatibility fallback.
The parent snapshot, existing stream files and real-pipeline test fixture stay:
each has live consumers beyond the removed decoder walk.

Unproven: the native transitions listed above. Synthetic regressions prove
handling of those database states, not WhatsApp's private version contract.
A later [full CLI benchmark](whatsapp-full-import-benchmark.md) measured
299.98 seconds for a fresh import with transcription off and 4.10 seconds for
an unchanged repeat; attachment text extraction dominated the fresh run.

Unresolved: native coverage remains in #2909; checkpoint representation and
its measured growth remain in #2781. Neither is hidden by the warm-scan result.
