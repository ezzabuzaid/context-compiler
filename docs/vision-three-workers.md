# Three persistent OCR workers — elt #2928

Three workers won the measured comparison. Recognition of the same 681 WhatsApp
images fell from a mean **11.54 to 7.96 seconds**, **31.0% less time**. Every one of
the **2,724** outputs matched the previously imported text exactly, including
null results. Mean sampled peak worker RSS increased **206 MiB**, from 565 to
771 MiB. The fresh full WhatsApp pass then fell from **31.83 to 27.57 seconds**,
**13.4% less wall time**, with transcription off and startup included.

## Controlled image comparison

The unchanged native helper processed the same sorted 681-image corpus in
**2, 3, 3, 2** worker order. Each run created fresh workers, awaited the existing
eight-language warm-up, distributed the next image to the next available worker,
and compared every response with the stored text before accepting it. The helper
binary and corpus hashes were identical across runs. All workers exited.

| Workers | OCR time | Startup + OCR | Sampled peak worker RSS |
| ------- | -------: | ------------: | ----------------------: |
| 2       | 11.681 s |      12.531 s |               562.0 MiB |
| 3       |  7.792 s |       8.879 s |               770.2 MiB |
| 3       |  8.120 s |       8.998 s |               771.6 MiB |
| 2       | 11.393 s |      12.159 s |               567.8 MiB |

RSS is resident memory reported by `ps`, summed across the native workers.
Samples landed about every 0.21 seconds. This is sampled peak RSS, not a bound
on short-lived peaks or the unique physical memory cost: shared pages may count
more than once, and separate Apple system services are excluded. The harness
and sample rate were the same in every run. The Mac had about 63 GiB free disk
and 5.4 GiB swap in use before these runs; no apps or shared services were stopped.

## Full WhatsApp pass

Each pass removed only the generated WhatsApp import and its checkpoints, then
ran the real CLI against the configured shared Imports directory:

```sh
node apps/cli/dist/main.js \
  --directory "$HOME/Library/Application Support/Context Compiler/Imports" \
  --transcription-model off sync --connector whatsapp --json
```

An identical temporary preload in both runs recorded worker readiness and
`Pipeline.run` boundaries. The wall timer spans Node spawn through process exit,
including attachment text completion and shutdown.

| Measurement                    |     Two workers |           Three workers |
| ------------------------------ | --------------: | ----------------------: |
| Full wall time                 |        31.826 s |                27.566 s |
| Data ingestion                 |        18.953 s |                18.496 s |
| Data report received           |        19.988 s |                19.177 s |
| After data report through exit |        11.838 s |                 8.390 s |
| Each worker's warm-up          | 0.950 / 0.949 s | 1.202 / 1.201 / 1.201 s |

Both passes wrote **342,770 rows across 32 successful streams**, with identical
per-stream written/deleted/error results. All **795** attachment references,
parser identities, statuses and text hashes matched. There were zero attachment
errors. All 62 voice files remained unsupported with no transcript. Settings
were unchanged, both exits were zero, and every worker exited.

Warm-up overlapped ingestion. The interval after the data report includes
parsing, text writes and shutdown; it is not a pure OCR timer. These are warm
OS/model-cache results on this Mac, not cold compilation measurements. Ingestion
also varied, so the full wall-time difference is an observed pair, not an
attribution of every millisecond to the worker count. The isolated alternating
runs establish the OCR improvement separately.

## Implementation, regression and ownership

The existing `Vision` in elt owns worker admission, native requests, cancellation
and disposal. Its existing `p-queue` concurrency changes from two to three; the
worker array already uses that value. The CLI and MCP server keep ownership of
startup and shutdown. The connector already admits four attachment reads, so its
code does not change. No public option, dependency, protocol or native recognition
setting was added.

The regression was run before the production edit. It pauses two real native
workers with `SIGSTOP` and queues four distinct images through the existing
`MacOSDocumentParser`. The two-worker implementation failed with **0 instead of
2 completed reads**. With three workers, the remaining worker drains those two
reads; after `SIGCONT`, all four outputs match their input positions. The
five-second watchdog detects lack of progress, not a required benchmark speed.

The existing tests now exercise all three workers: multilingual text, response
association, blank/corrupt files, worker failure and replacement, active and
queued cancellation, and disposal while reads wait. MCP lifecycle tests verify
three workers start before a tool call, survive transcription-setting changes,
and exit on stdin closure or SIGTERM. No dependency is mocked.

Passed: all eight `source-apple-macos:test` tests; the two selected real MCP
lifecycle cases through `server:test`; both changed projects' Nx typecheck
targets, including formatting and lint; all 65 elt builds; and `cli:build`.
The MCP run used `--skipNxCache` to rebuild the actual plugin bundle.

## Scope and removal audit

- **Scope:** `vision.ts`, its existing native parser tests, and the MCP lifecycle
  test. The production file replaces two lines, net zero; native tests grow by
  ten lines; the MCP assertion replaces two lines, net zero. This report and its
  aggregate JSON are evidence files. No other production change was necessary.
- **Consumers:** 12 public `new Vision(...)` sites across CLI `main.ts` (1), MCP
  `startup.ts` (1), native `image-format.test.ts` (5), Mail tests (1), Messages
  tests (2), connector transcription tests (1), and Instagram connector tests
  (1). The constructor shape is unchanged. All were inspected; the native and
  MCP cases and the full WhatsApp CLI were executed.
- **Discovery:** the installed public `p-queue` 10 options and runtime already
  supply concurrency control. No exported worker-count constant or native
  timing/memory hook exists; the current Vision/helper code has no TRACE, DEBUG,
  VERBOSE or environment hook. The native worker's existing JSON Lines protocol
  and OS `ps` provided the comparison boundary.
- **Retained:** the queue, worker slots, request timeout, crash replacement and
  cancellation ownership remain necessary and tested. Nothing in that mechanism
  was removable for this task. The native accurate recognition and automatic
  language detection are unchanged.
- **Rejected:** a configurable worker pool, extra attachment-reader concurrency,
  retries, new dependencies and changes to recognition quality. The measured
  requirement is met by the existing concurrency setting.
- **Unproven:** cold compiler latency, Intel performance and total unique system
  memory consumption. The known native startup delay remains tracked as #2896.
  Temporary probes were removed; logs and results remain under `/tmp/cc2928`.

[Aggregate results](probes/vision-three-workers-results.json) contain timings,
counts and hashes, without private text or file paths.
