# Two persistent OCR workers — elt #2922

The fresh full WhatsApp import fell from **45.84 to 34.80 seconds** with
transcription off: **11.03 seconds saved, or 24.1% less wall time**. Both timings
include Node startup, multilingual OCR warm-up, attachment completion and shutdown.
All **795** file results matched exactly by reference, parser, status and
extracted-text SHA-256. Both imports wrote 342,768 rows across 32 successful
streams, with zero attachment errors. All 62 voice files remained unsupported
without transcripts, and settings were unchanged.

| Measurement                    | One worker |     Two workers |
| ------------------------------ | ---------: | --------------: |
| Full CLI wall time             |    45.84 s |         34.80 s |
| Each worker's warm-up          |     0.81 s | 0.87 s / 0.87 s |
| Data report received           |    24.48 s |         23.68 s |
| After data report through exit |    21.36 s |         11.12 s |

Warm-up overlaps data ingestion and is already included in wall time. The final
interval includes attachment parsing, text writes and shutdown; it is not a pure
OCR timer. These are successful warm-cache measurements on Apple Silicon/macOS
27.0 with Node 26.10.0. Apple's model caches were not reset, so this comparison
does not measure a cold model compilation or establish a latency bound.

## Implementation and ownership

The problem was head-of-line blocking: a slow image occupied the only worker
while other images waited, as requests can wait behind one slow connection.
`Vision` in elt now starts two workers and uses its existing `p-queue` with
concurrency two. Each task takes a free worker; a blocked worker does not hold
subsequent requests on the other worker. No caller chooses a worker.

Elt's `Vision` owns recognition and its two processes. The MCP server and CLI still
own the `Vision` lifetime. The connector already admits four concurrent file
reads, so it needs no change. Both workers perform the existing eight-language
warm-up. A crash fails that image and the next request replaces only the failed
worker. Cancellation kills only the worker serving that request. Disposal stops
both workers and rejects queued work without starting replacements.

## Regression evidence

The first test was written and run before editing production code. It pauses a
real native worker with `SIGSTOP` and queues four distinct images through the
real `MacOSDocumentParser`. The one-worker version failed with **0 versus 3**
completed reads. The two-worker version passes: three finish while one is paused,
then all four outputs match their input positions after `SIGCONT`. The five-second
watchdog detects lack of progress; it is not a throughput requirement.

The final eight native tests pass. Coverage includes concurrent response
association, multilingual recognition on both reused workers, blank/corrupt
images, an in-flight `SIGKILL` with the other read succeeding, replacement,
active and queued cancellation, and disposal with pending reads. Cancellation
tests call the real `ImageFormat.text` boundary to enter the queue synchronously,
avoiding a race with asynchronous file-header reads. No OCR dependency is mocked.

The two real MCP lifecycle cases pass: both workers exist before any tool call,
survive transcription-setting changes, and exit on stdin close and SIGTERM.
The tests also check that interrupted warm-up leaves no named temporary files.

An initial unchanged test run hit the existing native warm-up failure #2896
(`SIGTRAP`, Vision Code 1). That failure was not counted as the regression's red
result. The focused red/green test, final suite and both full imports subsequently
ran successfully. This scheduling change does not address that separate issue.

Validation ran the `source-apple-macos:test` and filtered `server:test` Nx targets,
both projects' `typecheck` targets, all 65 elt builds, and `cli:build`. The MCP test
forced a bundle rebuild with `--skipNxCache` because the host cache does not
reliably notice sibling elt changes. No cache configuration was changed.

## Full-pass method

Each run removed only the generated WhatsApp import and its checkpoints from the
configured shared Imports directory, then ran the real CLI with:

```sh
node apps/cli/dist/main.js \
  --directory "$HOME/Library/Application Support/Context Compiler/Imports" \
  --transcription-model off sync --connector whatsapp --json
```

The timer started immediately before spawning Node and ended when it exited.
Both runs used the same temporary preload listener to record each native worker's
first readiness response and then detach. It changed no recognition requests or
options and adds small observation overhead. Both exited with code zero. Persisted
sync attempts, stream status, attachment results and settings were checked after
exit; the earlier data report alone was not treated as completion.

## Removal and scope audit

- **Removed:** the single-worker scheduling bottleneck. Output parity, blocked
  worker progress, cancellation and shutdown tests are the executed evidence.
- **Net delta:** production `vision.ts` adds 26 lines and removes 20, net **+6**.
  Tests add 156 and remove 27, net **+129**. Evidence files are additional prose
  and measurements. No package, public API, worker protocol or configuration was
  added. The native Swift implementation is unchanged.
- **Retained:** `p-queue` owns admission and concurrency; the existing worker
  owns stdio, deadlines and native errors. Accurate recognition, automatic
  language detection, eight-language readiness and host disposal are unchanged.
  All constructor consumers were checked in the CLI, MCP startup, connector
  transcription/Instagram tests and native parser tests.
- **Discovery:** inspected the installed `p-queue` 10 API and implementation.
  Its concurrency setting handles admission. Passing its abort option would
  release capacity before the underlying native task finishes, so existing
  cancellation ownership remains with `Vision` until that worker closes.
- **Rejected:** round-robin queues, a configurable/general worker pool, new
  dependencies, automatic retries and changes to attachment selection. They are
  unnecessary for the measured two-worker requirement.
- **Unproven:** cold model compilation latency, Intel runtime performance and
  peak memory cost. Two processes retain model state instead of one.
- **Unresolved:** none within #2922; native runtime issue #2896 remains separate.
  Temporary probe programs were removed and no owned process was left running.

[Aggregate results](probes/vision-two-workers-results.json) contain counts and
timings without private message text. Raw local evidence is under `/tmp/cc2922`.
