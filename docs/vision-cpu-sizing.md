# Five-worker cap versus one worker per available CPU

**These measurements describe this Mac, not a portable worker-sizing policy.**
Node reports 14 available CPUs on this Apple M4 Pro. Fourteen workers saved
**0.81 seconds (3.1%)** on a full WhatsApp pass, but used **1.35 GiB more worker
RSS** and failed exact text parity. The later
[cause investigation](vision-nondeterminism.md) reproduced variation directly
inside Apple Vision with just one process. The original recommendation to keep
five as a remedy for text variation is withdrawn. Sizing must account for each
device's resources; production still uses `Math.min(5, availableParallelism())`
pending that separate implementation.

These are fresh comparisons of both requested policies. Every comparison used
ABBA order: **5, 14, 14, 5**, which reduces run-order effects. No build, test or
other benchmark ran concurrently. No other app or shared service was stopped.

| Mean measurement                        | Five-worker cap | All 14 available CPUs |
| --------------------------------------- | --------------: | --------------------: |
| OCR of 681 images, after warm-up        |         5.502 s |               4.797 s |
| Startup + those images                  |         6.646 s |               7.483 s |
| Full WhatsApp pass                      |        25.895 s |              25.089 s |
| Full-pass data ingestion                |        18.819 s |              18.753 s |
| Full-pass interval after data report    |         6.140 s |               5.491 s |
| Full-pass sampled peak worker RSS       |       1,093 MiB |             2,474 MiB |
| Full-pass sampled peak CLI + worker RSS |       1,661 MiB |             3,058 MiB |

Fourteen cuts warmed OCR time by **12.8%**, but its heavier warm-up makes the
standalone startup-plus-OCR workload **12.6% slower**. Warm-up overlaps data
ingestion in the CLI, so the full pass still finishes slightly sooner. Individual
workers warmed in about **1.10–1.16 seconds** with five and **2.30–2.75 seconds**
with fourteen during the full passes.

## Full passes, including startup and shutdown

| Workers | Wall time | Data ingestion | After data report | Peak worker RSS | Text differences |
| ------- | --------: | -------------: | ----------------: | --------------: | ---------------: |
| 5       |  25.918 s |       18.865 s |           6.137 s |     1,092.9 MiB |                0 |
| 14      |  25.013 s |       18.864 s |           5.423 s |     2,475.7 MiB |                1 |
| 14      |  25.164 s |       18.643 s |           5.560 s |     2,471.6 MiB |                1 |
| 5       |  25.872 s |       18.773 s |           6.142 s |     1,094.1 MiB |                0 |

Each pass removed only the generated WhatsApp import/checkpoint folder and used
the real CLI with transcription off. The wall timer started before spawning
Node and stopped on exit. All four passes wrote **342,770 rows across 32
successful streams**; stream counts and errors matched. All **795 attachment
references, parser identities and statuses** matched. No attachment failed; the
62 voice files remained without transcripts. Settings were unchanged. The final
pass used five workers, leaving its output in the shared Imports directory.

RSS is resident memory reported by `ps`, sampled about every 0.20 seconds and
summed across the named processes. It can miss brief peaks, count shared pages
more than once, and excludes separate Apple services. It is not unique physical
memory. The machine started with about 64 GiB free disk and 4.7 GiB swap used.

## Exact-text checks

The first exploratory fourteen-worker run stopped on a changed Arabic result
(two missing diacritics). Its incomplete timing is excluded. The subsequent
complete comparisons recorded differences rather than stopping early:

| Check                                        |       Five workers |   Fourteen workers |
| -------------------------------------------- | -----------------: | -----------------: |
| Two full 681-image scans                     | 0 / 1,362 differed | 2 / 1,362 differed |
| Two full imports, 795 attachments each       | 0 / 1,590 differed | 2 / 1,590 differed |
| Four affected images, 20 repeats each, twice |   0 / 160 differed |   3 / 160 differed |

Differences occurred on different images and included added or missing short
lines and diacritics. The targeted repetition confirms nondeterminism: identical
image bytes sometimes produced different text within the fourteen-worker
configuration. The helper binary, recognition settings and inputs were unchanged.
This establishes failed exact-output equivalence under the tested workload; it
does not identify the underlying Apple Vision cause or prove that five can never
vary. Neither variant's recognition accuracy was judged against a human transcript.

## Scope and method

The isolated comparison used the native helper's existing JSON Lines protocol.
The CLI comparison used Node's public
[synchronous load hook](https://nodejs.org/api/module.html#synchronous-loadurl-context-nextload)
to vary exactly two expressions inside each benchmark process: `Vision`'s queue
capacity and `AttachmentText`'s admission capacity. The fourteen variant replaced
`Math.min(5, availableParallelism())` with `availableParallelism()`; the five
variant loaded the existing expression unchanged. Both runs used the same hook
and timing instrumentation. The hook asserted one matching expression per module,
and traces confirmed both modules and the expected worker count in every run.

No production files, builds, tests, APIs or configuration changed. Source and
built-file SHA-256 checks verified that after the runs. No new regression tests
or Nx builds were needed for this measurement-only task. The existing lifetime,
warm-up, cancellation and disposal behavior remains in place. A configurable
pool, repository copy and new dependency were unnecessary.

The four temporary probe programs were removed and every tracked process exited.
Only this report and [aggregate results](probes/vision-cpu-sizing-results.json)
were added to the repository. Private differences and raw logs stay under
`/tmp/cc-ocr-sizing`; aggregate evidence contains no private image text or paths.
Cold compilation, other Macs and unique system-wide memory remain unmeasured.
