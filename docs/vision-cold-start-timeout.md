# OCR cold-start timeout (#2896)

Follow-up: [cold-start latency investigation and startup ordering](vision-cold-start-latency.md) addresses duplicate model compilation. This report records the earlier deadline fix and its measurements.

Follow-up (#3067, 2026-10-31): elt's `VisionWorker.ready()` now gives the warm-up a time limit of 10 minutes. When the limit ends, the worker kills the native process, and the file that waits for it fails. The next file starts a new worker. Thus the sentence below, "A stuck initialization waits until the native process returns/exits or the caller cancels/closes the host", is no longer true.

Measurement caveat discovered in the follow-up: overriding the SDK constructor's
default container does not redirect the source, which passes an explicit container.
The earlier probe did not assert the paths actually opened. Its frozen-input claim
below is therefore not established; use the corrected follow-up comparison, which
asserts the container and all ten database paths. The recorded timings and output
comparisons remain historical observations.

The host applied the image-read deadline to native model initialization. After
120 seconds it killed a worker that had not yet emitted `ready`, failed the
waiting file, and started a replacement for the next file. The failure was our
timeout policy: a deadline intended to bound recognition also bounded Apple's
model compilation.

Elt's `VisionWorker.read()` now starts the existing 120-second deadline **after
readiness**. The JSON-lines receiver no longer owns that timer. Native exit,
invalid responses, per-image timeouts, cancellation and host shutdown still fail
or stop the appropriate work. A stuck initialization waits until the native
process returns/exits or the caller cancels/closes the host. This fixes premature
termination, not Apple's compiler latency or its historical E5RT errors.

## Scope and evidence

There are two production pool owners: CLI `apps/cli/src/main.ts` and MCP
`apps/server/src/startup.ts`. The connector's `Transcription` supplies their
`Vision` to `ImageFormat`, which delegates each image read. The shared worker
knows the readiness boundary; the hosts know when to shut down. No host, desktop,
native recognition, pool-sizing, configuration or public-export change is needed.

`VisionWorker.#next()` had exactly two callers: the constructor's readiness
handshake and `read()`. The original deadline was introduced in elt commit
`7bc0474b`, explicitly carrying forward the old per-image osascript deadline.
The existing local transcription worker already waits for its native response or
exit without a separate startup deadline and uses disposal for shutdown.

Before implementation, all nine macOS source tests passed. The new regression
then failed with `Vision worker exited (SIGTERM)`: it holds real native workers
with SIGSTOP, advances Node's host clock past 120 seconds, resumes them, and
requires successful real parser output from the same processes. It passed after
the fix. Apple's shared compiler cache cannot be reset in a test, so only the
clock is simulated; the fixture, worker, protocol and parser are real. Additional
tests preserve the image deadline, recovery on the next read, and shutdown during
warm-up. The existing tests cover multilingual text, concurrent response routing,
corrupt images, cancellation and disposal with queued work.

The public Node test runner's [MockTimers API](https://nodejs.org/api/test.html#class-mocktimers)
provides the clock seam. The package's exports and native worker have no startup
timeout option or tracing hook. Apple's background-processing hint permits
slower execution and does not fix this host deadline. Compute-device assignment
was already rejected by [the explicit device evaluation](vision-compute-devices.md).
No retry, larger constant, fallback device or new dependency was added.

A separately compiled single helper, using the unchanged Swift recognition code
with timing messages, became ready in **59.96 seconds**. Its first three language
passes took approximately 29.42, 16.40 and 13.33 seconds; all remaining scripts
together took under half a second. This was a fresh binary, not a reset of all
system caches. It did not exceed the old deadline.

The subsequent real production-helper regression run did exceed 120 seconds.
A worker sample showed `VNRecognizeTextRequest → MILCompilerForANE → _ANEClient
compileModel → synchronous XPC`. All six initial workers were still alive after
127 seconds. The first real parser test eventually passed in 310.72 seconds;
the whole suite passed 12/12 in 321.48 seconds. That first test includes fixture
creation, readiness, OCR and crash recovery, so 310.72 seconds is not a precise
warm-up-only measurement. No shared compiler process was restarted during this
task. The MCP tests also passed both stdin and SIGTERM shutdown cases.

## Full-pass measurement

Both fresh imports used the actual CLI and production helper, with transcription
off. The probe prepared a frozen input but did not establish that the source read
it; these are not accepted as controlled frozen-input benchmarks. The timer
starts before spawning Node and ends at
process exit, including module loading, worker startup, multilingual warm-up,
ingestion, attachment parsing and cleanup. Compilation caches had been warmed by
the preceding regression suite; these are startup-inclusive full imports, not
measurements of fresh system-wide model compilation.

| Run    | Startup to exit | Ingestion | Workers | Worker warm-up | Peak combined RSS |
| ------ | --------------: | --------: | ------: | -------------: | ----------------: |
| First  |         31.78 s |   19.85 s |       4 |  1.218–1.222 s |         1,315 MiB |
| Second |         41.90 s |   23.29 s |       4 |  1.616–1.640 s |         1,186 MiB |

Existing CPU/memory-based sizing selected four workers in both runs. Peak CLI
RSS was 742/670 MiB; peak summed worker RSS was 851/899 MiB. These separate peaks
are not simultaneous; the table uses the sampled combined peak. Shared compiler
RSS peaked separately at 82/87 MiB. RSS is resident memory, and summing processes
can count shared pages twice. Other active programs make system swap changes
unsuitable for attributing memory use to this import alone.

Both imports completed all **344,343 source rows across 32 tables and 891
attachments, with zero failures and all 95 Opus voice files untranscribed**.
All source values, attachment bytes and attachment metadata matched. **890 of 891
text results matched exactly; one image returned different text.** Both runs
loaded identical modules and helper bytes. This is an additional full-pass
witness for the existing #2942 nondeterminism investigation, not a claim that
this specific image has been reproduced in a standalone native loop. Recognition
settings and Swift source are unchanged by this fix. The aggregate keeps the
input and both text hashes, with no private text or media paths.

A snapshot was prepared at `2026-10-24T19:45:58.634Z`: ten SQLite online backups
and 925 referenced physical files totaling 393,209,262 bytes. All input database
and file hashes were rechecked after both imports, and each stored attachment
was checked against its SHA-256. Row comparison excludes only generated
`loaded_at`; SQLite 64-bit integers were read losslessly. The temporary load
hook attempted to select that container through the SDK default, which does not
control the source’s explicit container argument. Rehashing the prepared files
does not establish that they were used. Scan time and pipeline/worker timing were
instrumented. All owned workers exited.

The prior #2942 full passes were 32.64/33.74 seconds on 344,235 rows and 883
attachments, with five/four workers. These runs use a newer corpus and changing
machine load, so their times do not establish a performance improvement or
regression caused by the deadline change.

Executed checks: macOS source typecheck (formatter, lint and types), all 12 macOS
source tests, both real MCP lifecycle cases, all 65 elt package builds, CLI/server
builds and an uncached plugin bundle. The generated MCP artifact was inspected to
confirm that the deadline starts after readiness. Other device models and all
connector suites were not run.

[Aggregate evidence](probes/vision-cold-start-results.json) records timings,
counts, output digests, native probe steps, source hashes and check results.

## Change review

Production diff: 17 lines added, 17 removed in one file; the deadline moved to its
correct scope. Three regression cases add 88 lines in the existing test file.
Retained: the worker pool, native warm-up, validation, native exit diagnostics,
per-image deadline, cancellation, and app-lifetime ownership. Self-review found
no new wrapper, exported helper, fallback, compatibility path or configuration.
Temporary programs, the diagnostic binary, frozen databases/media and full
import outputs were removed after verification. Local diagnostic logs and hashes
remain under /private/tmp/cc2896, plus one 190 KB private image retained for the
unresolved #2942 text-variation case. That folder totals 888 KiB. Changes remain
unstaged and uncommitted. #2896 records the fixed deadline and stays open for its
broader native compilation/error risk; #2942 records the new text witness.

Including this report and the aggregate, the change adds 822 lines and removes
17 (net 805); most additions are regression evidence, not production code.
