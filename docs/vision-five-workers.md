# Five OCR workers, capped by available CPUs

Five workers won on this Apple M4 Pro. The same 681 images took a mean **5.54
seconds versus 6.28 with four**, **11.8% less OCR time**. All **2,724 text/null
outputs matched exactly**. Mean sampled peak worker RSS rose from **946 to 1,129
MiB**, an additional **182 MiB**.

The worker pool and attachment reader now use `Math.min(5,
availableParallelism())`. Node reports 14 available CPUs on this Mac (10
performance and four efficiency cores). This is a CPU-capacity ceiling, not a
measurement of currently idle cores. No runtime resizing or configuration was
added. The native recognition implementation and host lifecycle are unchanged.

## Same-image comparison

Fresh native workers read the same sorted corpus in **4, 5, 5, 4** order (ABBA,
which reduces run-order effects). Every worker completed its existing
eight-language warm-up before OCR timing began. Each response was compared with
the stored text or null. The helper binary and corpus hashes stayed identical.

| Workers | OCR time | Startup + OCR | Sampled peak worker RSS |
| ------- | -------: | ------------: | ----------------------: |
| 4       |  6.351 s |       7.673 s |               944.8 MiB |
| 5       |  5.537 s |       6.714 s |             1,122.0 MiB |
| 5       |  5.546 s |       6.689 s |             1,135.4 MiB |
| 4       |  6.212 s |       7.227 s |               948.1 MiB |

RSS is resident memory reported by `ps`, summed across workers and sampled about
every 0.20 seconds. It may miss short peaks, count shared pages twice, and excludes
separate Apple services. These figures are not total unique physical memory.
No other apps or shared services were stopped. No build or test ran during a
performance measurement.

## Full WhatsApp pass

Each run removed only the generated WhatsApp import and checkpoint folder, then
ran the real CLI with `--transcription-model off sync --connector whatsapp --json`
against the shared Imports directory. Wall time starts before Node is spawned and
ends when it exits, including startup and shutdown. An identical temporary
preload recorded worker readiness and `Pipeline.run` in both runs.

| Measurement                    |  Four workers |  Five workers |
| ------------------------------ | ------------: | ------------: |
| Full wall time                 |      26.269 s |      25.719 s |
| Data ingestion                 |      18.261 s |      18.758 s |
| Data report received           |      19.172 s |      19.441 s |
| After data report through exit |       7.097 s |       6.278 s |
| Each worker's warm-up          | 0.950–0.980 s | 1.336–1.338 s |

Full wall time fell **0.55 seconds (2.1%)** in this pair. The interval after the
data report fell **0.82 seconds (11.5%)**, while ingestion took longer. That final
interval includes all attachment parsing, text writes and shutdown; it is not an
OCR-only timer. Warm-up overlapped ingestion. The separate ABBA comparison
establishes the OCR improvement without attributing ingestion variation to it.

Both passes wrote **342,770 rows across 32 successful streams**. Every stream's
written/deleted/error counts matched. All **795 attachment references, parser
identities, statuses and text hashes** matched, with zero failures: 236 images
with text, 445 without text, seven PDFs, three text files and 104 unsupported
files. The 62 voice files had no transcripts. Settings were unchanged and every
worker exited.

## Regression tests and scope

The existing public seams remain the real macOS document parser, the attachment
reader over a real Pipeline and SQLite import, and the spawned stdio MCP server.

1. Before changing `Vision`, the parser test paused four real workers with
   `SIGSTOP` and queued six distinct images. It failed with **0 instead of 2**
   completed reads. The five-worker cap made it pass; all six texts matched after
   resuming the paused workers.
2. Before changing attachment admission, its existing slow-file regression failed
   with **4 instead of 5** simultaneous reads. Raising admission to the same CPU
   cap made it pass. The existing HoldingParser delays the real parser because a
   real file cannot be made predictably slow; Pipeline, files and SQLite are real.
3. Existing tests now fill the CPU-sized pool for multilingual text, active/queued
   cancellation, replacement, disposal and partial-progress recovery. Both MCP
   tests verify startup before any tool call, reuse after settings changes, and
   cleanup on stdin close and SIGTERM.

All eight native parser tests, 21 connector tests and two selected MCP lifecycle
cases passed. Nx formatting/lint/typecheck passed for `source-apple-macos`,
`connector` and `server`; all 65 elt builds and `cli:build` passed. The MCP test
rebuilt its bundle with `--skipNxCache`. Built CLI dependencies and the MCP bundle
contain the new CPU cap.

Ownership stays with elt's `Vision` for native workers, `AttachmentText` for file
admission, and the CLI/MCP server for lifetime. The desktop host needs no change.
The 12 `Vision` constructions remain: CLI main, MCP startup, connector
transcription test, Instagram test, five native parser tests, Mail test and two
Messages tests. The four `AttachmentText` constructions remain: Connector's
production path, transcription test and two attachment test sites. No API changed.

## Removal audit and limits

- **Removed:** no production mechanism needed removal. Temporary probe programs
  were deleted after preserving their results. Repeated fixed-size arrays in the
  touched tests now exercise the CPU-sized pool.
- **Delta:** production +7/-3; tests +131/-122; evidence +309 lines across two
  new files. Total +447/-125, net +322. The added evidence records the benchmark;
  production remains two local ceilings. Most test churn is formatting.
- **Retained:** installed `p-queue` 10's public concurrency option, worker slots,
  warm-up, timeouts, cancellation and replacement. Node's public
  `availableParallelism()` supplies capacity; its installed types explicitly
  advise against using `cpus().length` for application parallelism. The native
  helper has no timing/RSS hook, so temporary probes used JSON Lines and `ps`.
- **Rejected:** an exported capacity abstraction, configurable pool, dynamic
  resizing, one worker for every one of this Mac's 14 CPUs, retries and recognition
  changes. None is needed for the measured five-worker requirement. The two simple
  ceilings stay local to their owners rather than adding cross-package plumbing.
- **Unproven:** fewer-than-five-CPU Macs, Intel performance, cold compilation and
  unique system-wide memory. The four-paused-worker test skips on fewer than five
  CPUs, and the slow-file concurrency test skips on a single CPU. Neither skipped
  here. These runs used warm OS/model caches; cold compiler issue #2896 remains.

All owned processes exited. Raw logs remain under `/tmp/cc-ocr-cpu`;
[aggregate results](probes/vision-five-workers-results.json) contain no private text
or attachment paths. Changes remain unstaged and uncommitted.
