# WhatsApp full pass after removing FileTransfer's pending map

The eight matched full passes do **not establish unchanged performance**.
Without the map, mean ingestion was **4.6% slower** and mean process wall time
was **5.1% slower**. The machine had concurrent background work and substantial
run-to-run variation, so these measurements do not prove that the refactor
caused the difference. All outputs matched, and both versions called
`LocalFiles.flush` exactly four times per pass.

| Mean of four passes per version | With map | Without map | Difference |
| ------------------------------- | -------: | ----------: | ---------: |
| Full CLI, startup through exit  | 27.888 s |    29.302 s |      +5.1% |
| Pipeline ingestion              | 19.708 s |    20.609 s |      +4.6% |
| After data report through exit  |  7.461 s |     7.727 s |      +3.6% |

## Every measured pass

ABBA ordering alternates controls and candidates to reduce run-order effects,
such as a later filesystem benchmark benefiting from warmer caches. After the
first block was noisy, a second, reversed block was added. All eight results
are retained in their execution order.

| Order | Version     | Full CLI | Ingestion | Storage flushes |
| ----: | ----------- | -------: | --------: | --------------: |
|     1 | With map    | 28.163 s |  20.102 s |               4 |
|     2 | Without map | 31.078 s |  22.407 s |               4 |
|     3 | Without map | 29.065 s |  19.635 s |               4 |
|     4 | With map    | 29.129 s |  20.437 s |               4 |
|     5 | Without map | 29.812 s |  21.182 s |               4 |
|     6 | With map    | 27.205 s |  19.268 s |               4 |
|     7 | With map    | 27.054 s |  19.026 s |               4 |
|     8 | Without map | 27.254 s |  19.213 s |               4 |

Ingestion ranges overlap: **19.026–20.437 s with the map**, and
**19.213–22.407 s without it**. The last adjacent pair differs by about 1%, but
that pair does not replace the less favorable aggregate result. A quiet-machine
comparison is still needed to resolve the no-slowdown acceptance criterion.

## Workload and correctness

Every pass loaded **344,020 rows across 32 successful streams** and processed
**877 attachments**. Stream reports, attachment references, parser identities,
statuses and extracted-text SHA-256 values matched exactly across all eight
runs. No attachment failed. All **94 audio files** remained unsupported with
null content, with `--transcription-model off` on every invocation.

The previous [five-worker run](vision-cpu-sizing.md) took **25.872 s overall**
and **18.773 s for ingestion**, but processed **342,770 rows and 795 attachments**.
Today's input contains 1,250 more rows and 82 more attachments. Comparing those
historical timings alone cannot isolate the map removal.

## Method and limits

WhatsApp was quit with approval for all eight measured runs and reopened
afterward. Ten SQLite stores were backed up with SQLite's online backup API;
media and profile-picture files were copied into one frozen input directory.
Each pass used the real CLI, a private settings copy and a freshly removed
generated import directory. This avoided the separate CLI watch that owns the
shared import. No source data or shared settings were changed by these eight
passes.

A temporary Node load hook supplied the frozen container through the existing
`WhatsAppDesktopSource` constructor. For the control, it also loaded the former
`FileTransfer` and `LocalFiles` modules from Git blobs
`b8217f58084adf9ac5bfa57e95c9f0fbf28649b4` and
`ca21a983d90241e2422fc43e2a7750f1da24e10e`. Both variants used the same hooks and
instrumentation. No checkout was copied or production source rewritten.

The wall timer ran from before spawning Node until process exit, including
startup, five OCR workers' warm-up, ingestion, attachment processing and
shutdown. Code hashes matched across all runs. All 40 benchmark workers exited;
the unrelated shared watch and its workers were left running.

Concurrent web benchmarks, antivirus and Spotlight were observed. One process
snapshot showed antivirus above one CPU core. This is evidence of competing
work, not proof of which process caused any measured delay. OS and Apple Vision
caches were warm; this was not a reboot or cold model-compilation test.

Earlier exploratory attempts are excluded for workload drift, a watch-owned
import that was skipped, or a frozen-input hook that failed its validation.
The aggregate file records those exclusions. No successful, validated pass from
the two matched blocks was discarded.

The existing regression tests cover empty, null, populated and repeated file
loads and propagation of non-ENOENT errors. They passed before this measurement;
this turn rebuilt the CLI successfully and changed no production code. The
refactor and this evidence are staged in their respective repositories.

[Aggregate results](probes/whatsapp-stateless-flush-results.json) contain no
private attachment text or references. Raw traces and hashes remain in
`/private/tmp/cc-whatsapp-stateless`; the temporary input, generated imports and
probe programs were removed after verification.
