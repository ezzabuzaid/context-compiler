# Device-aware OCR worker sizing

OCR now sizes its pool from available CPU and memory, instead of a fixed
five-worker ceiling. The final full WhatsApp comparison used four and five
workers, with **9.3% lower mean peak worker RSS** and **5.6% longer total time**
than fixed five workers. This implements resource budgeting; this measurement
is not a demonstrated speedup.

## Policy and ownership

Resource budgeting limits concurrency to what the host can afford, like a
connection pool sized to its database host. At startup:

```text
workers = max(1, min(available CPUs, floor(available bytes / 2 GiB)))
```

| Available CPUs | Available memory | Workers |
| -------------: | ---------------: | ------: |
|              1 |           16 GiB |       1 |
|              8 |            2 GiB |       1 |
|              8 |          3.9 GiB |       1 |
|             14 |           10 GiB |       5 |
|             14 |         12.5 GiB |       6 |
|             14 |           48 GiB |      14 |
|             24 |           64 GiB |      24 |

Elt's `visionConcurrency` owns the calculation. `Vision` uses it when creating
its warmed native pool; `AttachmentText` uses it for attachment admission at
module initialization. Each samples available resources at its own startup;
the resulting limits stay fixed for that lifetime. The MCP server and CLI
continue to own startup, warm-up, reuse and disposal.

The CPU input is Node's [`availableParallelism()`](https://nodejs.org/api/os.html#osavailableparallelism),
not a measurement of currently idle cores. Memory comes from
[`process.availableMemory()`](https://nodejs.org/api/process.html#processavailablememory).
The installed libuv 1.53.0's [macOS implementation](https://github.com/libuv/libuv/blob/v1.53.0/src/unix/darwin.c#L121-L130)
includes free, inactive and purgeable pages. The initial live probe reported
about 10 GB available but only 71 MB from `freemem()`, so using free pages alone
would have undersized this Mac.

Two GiB is a conservative allocation budget, not measured per-worker usage or
a hard memory limit. Earlier worker RSS measurements were around 180–220 MiB;
RSS omits allocations in Apple services and does not bound transient image
processing. Imports and other applications also need memory. No monitoring
loop, runtime resizing, new dependency or host configuration was added.

## Regression evidence

The test was written first at the approved public sizing-function boundary.
The unchanged five-worker policy failed the 8-CPU/2-GiB example: **5 versus 2**.
After the calibration below prompted more headroom, the revised expectation
failed the one-GiB policy: **2 versus 1**. The final policy passed all eleven
literal CPU/memory examples, including low memory and devices above five CPUs.

All **9 macOS parser tests**, **21 connector tests**, and both real MCP shutdown
cases passed. These cover multilingual OCR, queue progress, cancellation,
worker reuse and replacement, disposal, stored attachment text, and cleanup on
stdin close and SIGTERM. Pool-dependent tests now exercise the observed pool
size or CPU bound; they no longer assume five workers.

The macOS, connector and server Nx typechecks passed. The CLI and MCP bundles
were rebuilt. The complete 65-project elt build passed on retry after an
unrelated web-package type error was resolved by its ongoing work.

## Full WhatsApp comparison

All four runs used one frozen input and fresh private output, with transcription
off. Timing starts before spawning Node and ends on process exit, including
startup, multilingual warm-up, ingestion, attachment processing and shutdown.
ABBA ordering reduces run-order bias from changing cache or load conditions.

| Order | Policy       | Workers | Full CLI | Ingestion | Peak worker RSS |
| ----: | ------------ | ------: | -------: | --------: | --------------: |
|     1 | Fixed five   |       5 | 31.608 s |  21.445 s |       990.5 MiB |
|     2 | Device-aware |       4 | 32.754 s |  23.648 s |       817.2 MiB |
|     3 | Device-aware |       5 | 32.739 s |  24.521 s |       982.1 MiB |
|     4 | Fixed five   |       5 | 30.390 s |  20.935 s |       993.3 MiB |

| Mean of two runs               | Fixed five | Device-aware | Difference |
| ------------------------------ | ---------: | -----------: | ---------: |
| Full CLI                       |   30.999 s |     32.746 s |      +5.6% |
| Ingestion                      |   21.190 s |     24.084 s |     +13.7% |
| After data report through exit |    8.977 s |      7.682 s |     -14.4% |
| Peak worker RSS                |  991.9 MiB |    899.6 MiB |      -9.3% |
| Peak CLI plus worker RSS       | 1332.9 MiB |   1220.6 MiB |      -8.4% |

The device-aware runs sampled **9.23 GiB** and **10.38 GiB** available when
constructing Vision, selecting four and five workers. This is an observed
response to memory availability on the same 14-CPU, 48-GiB Mac.

Each run loaded **344,021 rows in 32 successful streams**, processed **877
attachments**, and had **zero failed attachments**. All **94 audio files** had
unsupported parsers and null text. Stream reports, attachment references,
parser identities and statuses matched exactly.

The first device-aware run matched all 877 text hashes. The second differed
on **two images** already covered by the [standalone Apple Vision investigation](vision-nondeterminism.md).
Thus exact text equality did not hold across every run; this change does not
fix Apple's previously reproduced text variation. Both five-worker controls
matched each other exactly.

## Rejected calibration and remaining native risk

The first candidate budgeted one available GiB per worker. Ten- and
11-worker full passes completed without attachment failures. A subsequent
12-worker pass failed **196 images**. A temporary hook forcing twelve workers
reproduced **176 failures**: the native processes emitted exactly 176 error
responses, matching the stored failures. The intervening five-worker control had
zero failed attachments. Native logs recorded E5RT precompiled compute-operation
creation failure, Code 13.

These results motivated more headroom; they do not establish an out-of-memory
cause or a universal twelve-worker threshold. Existing backlog **#2896** already
records similar failures with smaller pools. The final two-GiB policy's four
matched passes had no failures, but the underlying native reliability issue
remains open. Failed runs are retained as correctness evidence and excluded
from speed comparisons; failing OCR can make a pass misleadingly fast.

## Method and limits

The benchmark used SQLite online backups of ten WhatsApp stores, copied media,
and 386 profile pictures. It preserved the user's selection and used a private
settings copy with watching and transcription disabled. Each pass started with
no generated import or checkpoint. The existing shared CLI watch and its
workers were left running; no app or shared Apple service was stopped.

A temporary Node load hook selected the frozen source. Controls loaded the
committed Vision and AttachmentText modules from Git blobs into memory; no
checkout or source tree was copied. Hashes of 1,393 actually loaded modules and
the helper matched across the final passes, excluding the two compared modules,
whose hashes matched within each variant. An earlier whole-checkout guard
rejected a run when an unrelated web-article build changed files; the CLI did
not load that package. The aggregate retains this and the other setup attempts.

RSS was sampled every 250 ms and summed over the owned native children, with
CLI RSS recorded separately. It can double-count shared pages and omits Apple
services; it is not unique physical memory. Other web benchmarks/builds,
Spotlight, Apple services and the shared watch were active. Ingestion slowed
while the post-report phase shortened, so these runs do not isolate a causal
performance effect of worker sizing. OS and model caches were warm.

The two fixed caps were replaced by one shared calculation: **12 net production
lines added** across Vision and AttachmentText. Warm-up, timeout, validation,
cancellation and cleanup logic were retained. Native compute-device changes,
retries, live resizing and migrations were excluded. Other hardware, cold model
compilation and worst-case memory behavior remain untested.

[Aggregate results](probes/vision-device-sizing-results.json) retain all final
runs, calibration, failed attempts and checks without private attachment text
or paths. Raw hashes and traces remain in `/private/tmp/cc-device-sizing`;
temporary input snapshots, generated imports and probe programs are removed
after verification.
