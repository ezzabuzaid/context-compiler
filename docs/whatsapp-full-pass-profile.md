# Where the full WhatsApp pass spends its time

Measured on 2026-10-24 with Node 26.10.0, macOS 27.0, the compact WhatsApp
source and the persistent native Vision worker. Transcription was off.

**The successful profiled fresh pass took 93.11 seconds. A subsequent fresh
pass with warm OS/model caches and no profiling hooks took 44.88 seconds.**
Both rebuilt the generated WhatsApp output and checkpoints in the shared
import store, wrote 342,768 rows across 32 successful streams, and produced
exactly the same text/status for all 795 files. Neither had attachment errors.
All 62 voice files remained `unsupported` / `no_text`.

The next bottleneck is **first-use Vision initialization after the current
English warm-up**. Five actual image requests consumed 42.01 seconds; those
same images took 0.35 seconds combined on the subsequent warm read. This is
tail latency: a few unusually slow requests dominate the total.

## Critical path

The critical path is the sequence that determines completion time. This table
counts each elapsed interval once; nested operation totals below do not add
to it.

| Work                                               |   Seconds |
| -------------------------------------------------- | --------: |
| CLI startup and connection                         |      0.84 |
| Import rows, copy files, commit checkpoints        |     23.09 |
| Remaining wait for OCR warm-up after the data pass |      6.53 |
| Native OCR service for 681 images                  |     62.48 |
| Other attachment gaps, shutdown and profile flush  |      0.18 |
| **Total**                                          | **93.11** |

The worker's startup warm-up took 30.10 seconds. Most overlapped the data
pass; adding all 30.10 seconds to the table would double-count that overlap.
The attachment phase occupied 69.07 seconds. PDF/text extraction and most
result writes overlapped queued OCR work.

The V8 profile recorded about 75.6 seconds idle/waiting out of 93.0 sampled
seconds. JavaScript CPU execution was not the dominant end-to-end cost.

## The long image requests

| Input category                                | Initial request | Same input with caches warm |
| --------------------------------------------- | --------------: | --------------------------: |
| Profile-picture thumbnail; recognized Arabic  |        18.178 s |                     0.048 s |
| Profile-picture thumbnail; no recognized text |        12.975 s |                     0.029 s |
| Sticker                                       |         3.664 s |                     0.103 s |
| Profile-picture thumbnail                     |         3.637 s |                     0.092 s |
| Profile-picture thumbnail                     |         3.554 s |                     0.083 s |
| **Five combined**                             |    **42.007 s** |                 **0.354 s** |

The other 676 images used 20.47 seconds. Across all images, median service
time was 17 ms and the 95th percentile was 93 ms.

The helper warms recognition with a rendered English “Context Compiler” image.
Native logs for the successful worker show English language assets at warm-up
completion, Arabic assets at the end of the first 18.178-second request, and
Hindi assets at the end of the 12.975-second request. Korean, Russian and other
language assets appear later. An image yielding no text can still exercise
language detection and initialization.

These observations prove that the current warm-up leaves substantial first-use
latency for real inputs. Native model/language preparation is implicated; the
logs do not identify the exact internal cause of every outlier. We did not
clear Apple's caches or modify automatic language detection.

## One versus two workers

A separate read-only experiment sent every one of the 681 imported images to
the unchanged native executable. Trials ran in order **1, 2, 2, 1 workers**,
waiting for each worker's ready response before timing recognition.

| Workers | Recognition wall time | Matching results |
| ------- | --------------------: | ---------------: |
| 1       |              20.651 s |        681 / 681 |
| 2       |              10.869 s |        681 / 681 |
| 2       |              10.832 s |        681 / 681 |
| 1       |              20.996 s |        681 / 681 |

Warm-up in these trials took 0.135–0.171 seconds. All 2,724 outputs matched,
with no failures. Two workers reduce warm recognition time by about 48%,
roughly ten seconds here. This measures warm throughput, not cold-start
improvement. Increasing `AttachmentText` concurrency alone cannot achieve it:
`Vision` currently serializes requests through one native worker.

## The data phase

Inside the 23.09-second pipeline:

- 817 file-save calls occupied 7.55 seconds; duplicate bytes explain why save
  calls exceed the 795 unique stored files.
- 1,712 explicit file/directory synchronization calls occupied 6.73 seconds,
  largely within file saves. Actual file writes occupied 0.09 seconds. These
  are durability barriers: flushing changes to storage before proceeding.
- Timed SQLite calls occupied 5.00 seconds across source reads, staging,
  merges, metadata and checkpoints. Saving the 32 checkpoints used 0.093
  seconds of SQLite time; this excludes building/serializing their state.
- The sampled snapshot-diff stack accounted for about 8.8 seconds inclusive
  of source reads and nested functions. It overlaps the SQLite figure.

These are nested measurements, not independent slices to sum. During attachment
processing, SQLite calls used 0.63 seconds, seven PDFs used 0.82 seconds, and
three text files used 0.36 seconds. They are smaller targets than the observed
first-use image stalls.

## Next work and ownership

Backlog **elt #2921** records the next experiment: extend warm-up coverage to
representative multilingual images and the production image-reading path,
while preserving exact OCR output. The native helper in
`packages/sources/apple/macos/src/helper/main.swift` knows recognition behavior;
the MCP server's `startup.ts` continues to own startup and shutdown. WhatsApp
source scans and desktop React components do not own this work.

Measure startup and the complete import together. Moving initialization earlier
can hide latency behind other work or user idle time; it does not eliminate
the cold work. Do not skip profile pictures/stickers or restrict languages to
improve the score. A small two-worker change is a measured secondary option
for warm throughput, after the larger first-use stalls.

## Verification and environment

The command was the real CLI:

```sh
node apps/cli/dist/main.js \
  --directory "$HOME/Library/Application Support/Context Compiler/Imports" \
  --transcription-model off sync --connector whatsapp --json
```

The profiled run added V8 CPU sampling at 5 ms and temporary preload wrappers
around real pipeline, parser, file, SQLite and native stdio boundaries.
Per-image service time spans sending a request through receiving its response;
it includes native work, IPC and response delivery. Queue-inclusive durations
were measured separately and excluded from the critical-path sum. Instrumentation
adds overhead; the later 44.88-second control had no profiling hooks and warm
caches, so it is not an isolated overhead comparison.

Two earlier attempts are excluded: one had 680 image failures, and another
ended with an incomplete import. Free disk space fell below 1 GB with about
42 GB in swap. Native logs recorded E5RT compute-operation creation error 13;
a standalone worker also failed model compilation with error 11 and could not
initialize its orientation corrector. This evidence was added to existing
**elt #2896**. The environment changed afterward, so cleanup is not a controlled
proof of the failures' cause.

The user authorized Docker cleanup. Docker's API was unresponsive, so Desktop
was restarted. Pruning unused images reclaimed **8.929 GB**; the active
text2sql database container and all five volumes remained. Host free space
recovered above 20 GB, including OS allocation changes. The subsequent full
profile, four image trials, and full control all passed output comparison.

The final shared WhatsApp import is complete and healthy. Connector selections,
watch settings and transcription settings are unchanged. Every process started
for the probes has exited. No production code changed.

[Aggregate profile evidence](probes/whatsapp-full-pass-profile-results.json)
contains timings, counts and comparison outcomes without message or extracted
text content. Raw local profiles and logs are under `/tmp/cc-wa-profile`.
