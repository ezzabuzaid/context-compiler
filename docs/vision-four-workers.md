# Four persistent OCR workers

Four workers won the comparison and are enabled. The same 681 WhatsApp images
took a mean **6.67 seconds with four workers versus 8.15 with three**, **18.2%
less OCR time**. All **2,724** text/null outputs matched exactly. Mean sampled
peak worker RSS increased from **744 to 861 MiB**, a **117 MiB** tradeoff.

A fresh full WhatsApp pass fell from **29.37 to 26.75 seconds**, **8.9% less wall
time**, including startup and shutdown with transcription off. These are new
paired measurements, not the earlier three-worker run's timing.

## Same-image comparison

The unchanged native helper read the same sorted corpus in **3, 4, 4, 3** worker
order. Each run created new workers, awaited their existing eight-language
warm-up and assigned the next image to an available worker. Every response was
compared with the stored text, including nulls. Helper and corpus hashes matched
across runs; all workers exited.

| Workers | OCR time | Startup + OCR | Sampled peak worker RSS |
| ------- | -------: | ------------: | ----------------------: |
| 3       |  8.087 s |       9.101 s |               753.8 MiB |
| 4       |  6.905 s |       7.917 s |               875.3 MiB |
| 4       |  6.430 s |       7.411 s |               846.4 MiB |
| 3       |  8.215 s |       9.130 s |               734.1 MiB |

RSS is resident memory reported by `ps`, summed across workers, sampled roughly
every 0.21 seconds. It can miss short peaks, count shared pages more than once,
and excludes separate Apple system services. It is not total unique physical
memory consumption. The sampling procedure was the same for every run. The Mac
had about 63 GiB free disk and 5.3 GiB swap in use before the comparison; no apps
or shared system services were stopped.

## Full pass

Each run removed only the generated WhatsApp import and checkpoints, then ran
the real CLI against the shared Imports directory:

```sh
node apps/cli/dist/main.js \
  --directory "$HOME/Library/Application Support/Context Compiler/Imports" \
  --transcription-model off sync --connector whatsapp --json
```

The wall timer started before Node was spawned and ended when it exited.
Identical temporary preloads recorded native readiness and `Pipeline.run`.

| Measurement                    | Three workers |  Four workers |
| ------------------------------ | ------------: | ------------: |
| Full wall time                 |      29.371 s |      26.747 s |
| Data ingestion                 |      19.640 s |      19.019 s |
| Data report received           |      20.660 s |      19.726 s |
| After data report through exit |       8.710 s |       7.022 s |
| Each worker's warm-up          | 0.958–0.961 s | 1.290–1.301 s |

All **342,770 rows across 32 streams** had identical written/deleted/error
counts. All **795 attachment references, parser identities, statuses and text
hashes** matched, with zero failures. The 62 voice files remained unsupported
without transcripts. Both exits were zero and settings were unchanged.

Warm-up overlapped ingestion. The final interval includes parsing, text writes
and shutdown, not just OCR. Ingestion also varied, so the full wall-time gain
is an observed pair, not entirely attributable to worker count. The alternating
image comparison establishes the OCR gain separately. OS/model caches were warm;
the known cold compiler delay remains a separate issue (#2896).

## Regression and implementation

Before editing production, the existing real-parser regression was extended to
pause three native workers using `SIGSTOP` and queue five distinct images. The
three-worker implementation failed with **0 instead of 2 completed reads**.
Changing the existing `p-queue` concurrency from three to four made it pass:
the fourth worker drains the two reads, then all five results match their input
positions after `SIGCONT`. The five-second watchdog checks progress, not speed.

Existing tests now exercise four simultaneous multilingual reads, preserve
response association and image errors, replace only a failed/cancelled worker,
abort a genuinely queued request, and dispose all workers with queued work still
pending. The real MCP tests verify four workers start before any tool call,
survive transcription-setting changes and exit on stdin close and SIGTERM.

Validation passed: all eight native parser tests, both selected real MCP
lifecycle cases, both changed projects' Nx formatting/lint/typecheck targets,
all 65 elt builds and `cli:build`. The MCP test rebuilt the bundle using
`--skipNxCache`; the built CLI and MCP bundle both use concurrency four.

## Scope and removal audit

- **Ownership:** elt's `Vision` owns concurrency and native-worker behavior.
  The MCP server and CLI still own its lifetime. The connector already admits
  four attachment reads, so it needs no production change.
- **Scope:** the same 12 public constructor call sites audited in
  [the three-worker change](vision-three-workers.md) retain the same API. Current
  runtime consumers and count assertions were checked. Only `vision.ts`, its
  native tests and the MCP lifecycle assertion changed, plus this report and
  aggregate measurements.
- **Delta:** production replaces two lines, net zero. Native tests add 21 and
  remove 16 lines, net five; the MCP test replaces one line, net zero. Evidence
  files are additional prose and JSON. No dependency, option or protocol changed.
- **Retained:** the installed public `p-queue` concurrency option, worker slots,
  timeout, native warm-up, replacement and cancellation handling already do the
  required work. Nothing in this mechanism needed removal. The native recognition
  implementation is unchanged.
- **Rejected:** a general/configurable worker pool, extra attachment-reader
  concurrency, retries or recognition-quality changes. The existing setting
  fulfills the measured requirement. Existing code exposes no native timing/RSS
  hook; temporary measurements used the helper's JSON Lines protocol and `ps`.
- **Unproven:** cold compilation performance, Intel performance and total unique
  system memory. Issue #2896 remains open. No new guard or fallback was added.

Temporary programs were removed and all owned processes exited. Raw evidence is
under `/tmp/cc-ocr-four`; [aggregate results](probes/vision-four-workers-results.json)
contain no private text or file paths.
