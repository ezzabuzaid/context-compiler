# Attachment file group commit — elt #2923

The fresh full WhatsApp pass fell from **36.87 to 31.55 seconds** with
transcription off, including Node startup, OCR warm-up, attachment processing and
shutdown. Ingestion fell from **24.03 to 19.24 seconds**. Both passes loaded
**342,770 rows across 32 successful streams**. All **795 attachment results**
matched by reference, parser, status and extracted-text SHA-256, with no failures.

| Measurement                      |          Before |           After |
| -------------------------------- | --------------: | --------------: |
| Full CLI wall time               |        36.870 s |        31.548 s |
| Pipeline ingestion               |        24.031 s |        19.242 s |
| Data report received             |        24.925 s |        19.998 s |
| After data report through exit   |        11.946 s |        11.551 s |
| Each OCR worker's warm-up        | 0.950 / 0.951 s | 1.069 / 1.069 s |
| Directory fsync calls, whole CLI |             947 |             136 |
| File-content fsync calls         |             817 |             817 |

This is **5.32 seconds less total time (14.4%)** and **4.79 seconds less ingestion
time (19.9%)** in this pair of runs. The directly observed mechanism is **811
fewer directory fsync calls**. These are warm-cache measurements on the same Mac,
not a controlled estimate of every millisecond saved: OS caches were not reset,
and another agent's test runs overlapped the after run. The directory counts
include initialization, cleanup and checkpoint work, so they differ from the
data-phase-only counts in the earlier profile.

## Change and ownership

Group commit shares a durability barrier across writes, as a database commits a
batch in one transaction. `LocalFiles.save` still copies and syncs every complete
file and publishes an immutable content-addressed reference. Newly created
parent directories still sync when created. The new required
`FileStorage.flush(scope)` makes completed saves durable before rows commit.

`FileTransfer` remembers only the scopes it saved into, flushes each once at the
existing replication commit boundary, and clears that set. Replication then
checks cancellation, commits destination rows, reconciles retained files, and
advances the checkpoint. Storage owns filesystem durability; replication owns
ordering. No connector, CLI, MCP or desktop source change is needed.

The only production save caller is `FileTransfer`; `LocalFiles` is the only
production implementation. The declaration-only test implementation now supplies
the required method. The installed SQLite transaction API and existing stage
commit supplied the precedent and boundary. No package API offered a batch
filesystem flush that replaced this coordination, and no existing observation
hook covered it.

## Regression and validation

The regression was written first at the existing real source → Pipeline → SQLite
and LocalFiles boundary. It failed on the old implementation because a failed
flush was ignored and rows committed. The fix passed it. A cancellation case
then failed on the first implementation because aborting during the flush still
published version 3; checking cancellation before commit makes it pass.

Both cases verify the previous rows, checkpoint and attachment bytes survive,
and a real retry publishes the new bytes and removes obsolete files. Only the
external fsync failure is injected through a LocalFiles subclass: disk failure
cannot be produced reliably on demand. Copying, SQLite transactions and
checkpoints run for real.

Passed: full `elt:test`, `elt-sqlite:test`, `source-whatsapp-desktop:test`, both
changed projects' Nx typecheck targets (format, lint and types), all 65 elt
builds, and `cli:build`. The extra Postgres file-storage regression could not run:
Docker's daemon socket was absent. This was an environment failure before any
assertion, not a passing check.

## Benchmark method and removal audit

Each pass removed only the generated WhatsApp import and its checkpoints, then
ran the actual CLI with `--transcription-model off sync --connector whatsapp
--json` against the shared Imports directory. The wall timer spans process spawn
through exit. Identical temporary preload hooks counted fsync calls, marked
`Pipeline.run`, and recorded native readiness; no recognition options changed.
Both exits were zero, persisted settings were unchanged, and all 62 voice files
remained unsupported with no transcript. All owned workers exited.

- Removed: the directory flush after every file save. File-content flushes,
  immutable publication, directory validation and cleanup remain. The original
  durability requirement came from elt commit
  `6a4c25c3dcf7463eeb855b591b15cd679df93aee` and is now enforced before row commit.
- Net delta: production adds 24 lines and removes 4, net **+20**; tests add 146.
  Documentation adds the public flush contract and this evidence. No dependency,
  setting, compatibility path or general batching framework was introduced.
- Rejected: flushing only in `retain`, because it runs after rows commit;
  removing content fsync; batching source files after their lending lifetime.
- Unproven: physical power-loss behavior and Postgres runtime verification.
  Failure/cancellation tests establish ordering, not a hardware crash test.

## Back to OCR

The remaining **11.55 seconds after ingestion** include attachment parsing,
text writes and shutdown. A third fresh full pass added diagnostic timings around
the parser, Vision queue, worker stdio and attachment-text upserts. It took
**34.29 seconds including startup**, with **20.80 seconds of ingestion** and
**12.55 seconds inside attachment processing**. Transcription stayed off. All
32 stream counts and 795 attachment results still matched. This separately
instrumented run is a profile, not the after measurement in the table above.

| OCR diagnostic                                  |          Measured |
| ----------------------------------------------- | ----------------: |
| Each worker's warm-up, overlapping ingestion    |   1.057 / 1.056 s |
| Time with at least one Vision request in flight |          12.529 s |
| Time busy per worker                            | 12.478 / 12.491 s |
| 681 images: combined worker service time        |          24.969 s |
| Worker service time per image, median / p95     |   21.4 / 107.2 ms |
| Queue wait per image, median / p95              |    20.1 / 94.0 ms |
| 795 attachment-text writes, combined duration   |           0.478 s |
| 795 format identity checks, combined duration   |           0.264 s |

Worker service time spans sending a file path through receiving its response,
including native decoding, recognition and IPC. The two workers were busy for
about 99.5% of the attachment phase: worker saturation is the next bottleneck.
The existing attachment reader admits four files; adding queued files alone
does not increase the two workers' processing capacity. The next controlled
experiment is three workers against the same corpus, measuring wall time,
memory and extracted-text parity before changing the default.

The 236 images with text consumed 15.41 combined worker-seconds; the 445 without
text consumed 9.56. These are overlapping service times, not additive wall-time
phases. The seven PDF parses totaled 0.80 seconds and three text parses 0.25.
Skipping an image merely because this run found no text would change coverage.
No image contents or file paths are included in the
[OCR aggregate timings](probes/whatsapp-ocr-phase-profile-results.json).

Cold native compilation is still a separate issue: the previous profile observed
119.4 seconds in warm-up (#2896). This warm-cache pass does not resolve that.
No OCR implementation changed in #2923.

[Aggregate measurements](probes/whatsapp-file-flush-results.json) contain no
private message text. Raw local evidence is under `/tmp/cc2923`.
