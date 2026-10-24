# WhatsApp ingestion profile — next target: attachment flushes

The next small optimization is reducing repeated directory flushes in elt's
`LocalFiles`. In the instrumented data pass, saving attachments occupied
**9.65 seconds**, including **8.36 seconds of explicit file/directory `fsync`**.
Actual byte writes took **0.18 seconds**. This is durability overhead: waiting
for filesystem changes to reach storage, as a database does before committing.

A real-file experiment reduced copying from **8.11 to 4.83 seconds on average**
by deferring directory flushes, while retaining each file's content flush.
Every resulting object's SHA-256 matched. This establishes a throughput
opportunity of about **3.28 seconds in that experiment**, not an implemented
full-import improvement. Follow-up: **elt #2923**.

## Full passes, including startup

Both fresh imports used the real CLI, the shared configured import store, two
native OCR workers, and **transcription off**. The timer started immediately
before spawning Node and ended when Node exited.

| Measurement                       |    Detailed profile | Subsequent control |
| --------------------------------- | ------------------: | -----------------: |
| Full process wall time            |            130.57 s |            33.41 s |
| Node setup before `Pipeline.run`  |              1.08 s |             0.76 s |
| Data pipeline                     |             28.02 s |            22.03 s |
| Data report received after launch |             29.17 s |            22.86 s |
| Each OCR worker's warm-up         | 119.40 s / 119.40 s |    0.74 s / 0.74 s |
| After data report through exit    |            101.40 s |            10.55 s |

Warm-up overlaps ingestion; these rows must not all be added. The setup timer
starts at Node's performance time origin, while the full timer includes process
launch. The control retains only phase/readiness markers, without detailed I/O
wrappers or CPU sampling. Cache state and instrumentation differ, so the
28.02-to-22.03-second difference is not a code improvement or a pure estimate
of profiler overhead. The earlier #2922 control reported data at 23.68 seconds.

Both runs exited **zero**, wrote **342,768 rows across 32 successful streams**,
and produced **795 matching results** by reference, parser, status and
extracted-text SHA-256. Both had zero attachment errors. All **62 `.opus`
files remained `unsupported` / `no_text`**. Settings stayed unchanged. The
final shared WhatsApp import is complete.

## Where the data time goes

V8 sampled only the pipeline at 5 ms intervals. Assigning each sample once to
the deepest relevant component gives this approximate breakdown. Idle means
the JavaScript thread was waiting; it is elapsed time, not CPU consumption.

| Sample category                                          |   Seconds |
| -------------------------------------------------------- | --------: |
| Idle / waiting                                           |      9.31 |
| WhatsApp source reads and mapping                        |      7.49 |
| SQLite destination                                       |      4.12 |
| Snapshot diff / hashing                                  |      3.13 |
| Record validation                                        |      1.05 |
| Other work, file handling, GC and unassigned native work |      2.99 |
| **Sampled total**                                        | **28.10** |

The sample window includes profiler start/stop overhead. Actual pipeline CPU
usage was **17.42 seconds user + 1.91 seconds system**. Native work and wrapper
frames make the component attribution approximate.

Direct timers explain the waiting and database work below. These measurements
are nested and must not be added to the sampled table or to one another where
one contains another.

| Timed operation                        |   Calls | Seconds |
| -------------------------------------- | ------: | ------: |
| `LocalFiles.save`                      |     817 |   9.648 |
| Content `fsync`, inside saves          |     817 |   4.422 |
| Directory `fsync`, mostly inside saves |     895 |   3.942 |
| Source SQLite iterator steps           | 625,833 |   3.233 |
| Destination SQLite statement execution | 343,779 |   2.848 |
| File reads                             |     868 |   0.283 |
| Destination SQLite `exec`              |     551 |   0.189 |
| File writes                            |     900 |   0.177 |
| Checkpoint SQLite statement execution  |      64 |   0.128 |
| `LocalFiles.retain`                    |       8 |   0.028 |

The snapshot-diff stack takes **10.95 sampled seconds inclusive** of source
reads and nested work. That is not additional to the source/diff rows above.
The messages, receipts, reactions and reaction-count streams each iterate the
compact inputs and full message payloads on a first load. That repeated source
work is a substantial CPU cost. Checkpoint SQL itself is small; its 0.128-second
timer does not include constructing, hashing or serializing snapshot state.
The SQLite destination already stages rows and merges them in transactions;
343,779 statement executions do not mean 343,779 disk commits.

## File experiment and ownership

The temporary probe called the real `LocalFiles.save` and `FileContent` for all
795 imported paths, in order **current, deferred, deferred, current**:

| Directory flush policy      | Copy and retain time |
| --------------------------- | -------------------: |
| Current                     |              8.083 s |
| Deferred until final retain |              5.148 s |
| Deferred until final retain |              4.515 s |
| Current                     |              8.136 s |

Each trial used a new disposable directory and kept content `fsync` enabled.
Combining the inputs into one storage scope produced 784 distinct objects;
duplicates across the original scopes explain the difference from 795 paths.
Every save returned the expected content-derived basename, and all 784 stored
objects were independently read and hash-checked after each trial. Verification
and temporary-directory cleanup were outside the timed copy interval.

Mean time fell by **3.278 seconds (40.4%)**. This probe ran after ingestion had
finished, while its CLI awaited native OCR preparation; Apple's compiler was
still active. It is a small local experiment, not a latency bound.

Group commit means sharing a durability barrier across multiple writes, like a
SQLite transaction. `LocalFiles` knows which files and directories it publishes.
Elt replication knows when rows and checkpoints commit. Those owners must
coordinate any change; neither the WhatsApp connector nor the MCP host owns it.

The experiment deliberately publishes no database references or checkpoints.
It does **not** prove crash safety. The current replication calls `retain`
after destination commit, so simply moving flushes there could publish a row
before its file's directory entry is durable. Newly created parent directories
also need consideration. #2923 requires auditing the durable-save requirement
and real pipeline regression tests before changing production. No batching API
or production behavior was added in this profiling task.

## Native startup and cleanup

The machine restarted between the earlier failed attempts and these runs,
clearing swap and temporary evidence. We did not initiate that restart. The
successful detailed run was the first full run afterward. A native sample
showed `VNRecognizeTextRequest → e5rt_e5_compiler_compile → _ANEClient
compileModel → synchronous XPC wait`. Both workers became ready after 119.40
seconds, just inside the existing 120-second deadline. At inspection there was
about **72 GiB free and zero swap**. Low disk space alone therefore does not
explain this initialization wait. Apple's caches were not manually cleared,
and the internal compiler cause remains unproven. Evidence was appended to
existing **elt #2896**. The later control warmed both workers in 0.74 seconds.

The user authorized removing generated data. We deleted only
`Imports/mail/d58fec66e4f1d6c6`: **4,993,388,544 allocated bytes (4.65 GiB)**.
Available disk space increased by **4,836,282,368 bytes (4.50 GiB)** across the
deletion; concurrent OS activity can affect that difference. Mail's source
store and connector settings were preserved. The generated Mail import must
be rebuilt before querying it again. Tiny build caches were left in place.

All benchmark workers exited with their CLI, and the copy probes removed their
temporary directories. No shared compiler process was stopped in these runs.
No production code changed, so no regression suite was rerun. Aggregate
measurements and output parity were checked with assertions.

The command for both full passes was:

```sh
node --import /tmp/cc-wa-data-profile/observe.mjs apps/cli/dist/main.js \
  --directory "$HOME/Library/Application Support/Context Compiler/Imports" \
  --transcription-model off sync --connector whatsapp --json
```

The profile enabled temporary I/O wrappers and an inspector CPU sampler through
its environment; the control disabled them. The temporary programs were removed
after collecting evidence. [Aggregate results](probes/whatsapp-data-phase-profile-results.json)
contain no private message or extracted text. Raw profiles, hashes and logs
remain locally under `/tmp/cc-wa-data-profile` until the OS removes them.
