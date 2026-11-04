# Vision OCR with a pool that keeps learning

Measured on 2026-11-02, Node v26.10.0, macOS 27.0, on the Mac with 14 CPUs, with the built CLI and the live WhatsApp source.

`@zukhruf/pool` 0.6.14 changes `HillClimbing` from a sizing that learns once to a sizing that keeps learning: steps with one more worker or with fewer, for as long as the pool runs ([pool ADR 0007](https://github.com/JanuaryLabs/zukhruf/blob/main/packages/pool/docs/adr/0007-a-sizing-that-learns-keeps-learning-in-steps-both-ways-and-pauses-between-steps-that-change-nothing.md)). Two benchmarks compared it with the installed 0.6.7: a full WhatsApp import with the CLI, and a long-lived pool on the real Vision helper.

**Result 1: on a one-shot CLI import, the two versions read the attachments in the same time.** The OCR burst after the first step took 17.9 s on average with 0.6.7 and 18.9 s with 0.6.14. Both versions grew from two to four Vision workers. The output was the same in all runs.

**Result 2: a long-lived pool that keeps learning reads about 1.5 times more images a second.** After 8 minutes, the pool that learns once still ran the size of its first measurement, 3 or 2 workers, and read 32.9 and 39.2 images a second. The pool that keeps learning had grown to 6 workers and read 47.8 and 66.2 images a second. See [A long-lived pool under contention](#a-long-lived-pool-under-contention).

## Results of the CLI import

Order A, B, B, A, A, B, B, A. A is pool 0.6.7 (learns once). B is pool 0.6.14 (keeps learning).

| Run | Pool   | Full CLI | First step at | OCR after the first step | Most workers | Foreign helpers |
| --- | ------ | -------: | ------------: | -----------------------: | -----------: | --------------: |
| 1   | 0.6.7  |   82.7 s |        49.7 s |                 33.0 s ¹ |            6 |               1 |
| 2   | 0.6.14 |   58.7 s |        40.5 s |                   18.2 s |            4 |               0 |
| 3   | 0.6.14 |   52.0 s |        35.7 s |                   16.3 s |            4 |               0 |
| 4   | 0.6.7  |   48.6 s |        29.1 s |                   19.5 s |            4 |               0 |
| 5   | 0.6.7  |   37.8 s |        23.1 s |                   14.7 s |            4 |               0 |
| 6   | 0.6.14 |   45.6 s |        23.3 s |                   22.3 s |            3 |               0 |
| 7   | 0.6.14 |   67.3 s |        39.5 s |                 27.7 s ² |            4 |               3 |
| 8   | 0.6.7  |   41.9 s |        22.4 s |                   19.5 s |            4 |               2 |

¹ The first measured run, with colder caches. ² The desktop app started its own Vision helper again during the run, 20 times; the benchmark killed it each time.

Means without runs 1 and 7: 0.6.7 17.9 s, 0.6.14 18.9 s for the OCR after the first step.

"First step at" is the time when the pool first ran a third Vision worker. Before it, the CLI reads the 32 streams with two idle workers that `LeaderFirst` started. That data pass runs the same code in both versions, and it took from 22 to 50 s. Thus the full CLI time shows the machine more than the pool.

Each run produced 1,254 rows of attachment text, 1,326 files and 667,772 KiB, and loaded 32 streams.

## Why the versions do not differ here

A step measures three windows of at least 2 seconds each. The OCR burst of one CLI import lasts 15 to 30 s, so it has room for two to four steps. Both versions take the same first steps from two workers. A pool that keeps learning differs only after it settles: it tries the size again, lets a worker go after two steps in a row that do not pay, and reads the free memory again. The CLI exits before that matters.

The change is for a process that keeps its pool for a long time, such as the server of a chat, where the work and the other processes on the Mac change while the pool runs. The next benchmark measures that.

## A long-lived pool under contention

A program kept one pool for 8.5 minutes, with the pool of the CLI: `HillClimbing` with 2 GiB for each worker, `LeaderFirst` and `IdleTimeout` of 5 minutes, and the real `VisionWorker` of elt with its helper. Thirty-two callers read the 882 images of the WhatsApp store, one after the other, so jobs always waited. The run had three phases:

1. **Alone**, 150 s.
2. **Contended**, 180 s: a second process read the same images with a `Fixed(4)` pool of Vision workers, as a second chat server does.
3. **Alone again**, 180 s.

Order A, B, B, A. The numbers are images a second over the last two thirds of each phase.

| Run | Pool   | Alone | Contended (competitor) | Alone again | Workers at the end |
| --- | ------ | ----: | ---------------------: | ----------: | -----------------: |
| 1   | 0.6.7  |  32.0 |            30.5 (38.1) |        32.9 |                  3 |
| 2   | 0.6.14 |  54.1 |            33.7 (32.4) |      47.8 ¹ |                  6 |
| 3   | 0.6.14 |  11.4 |            41.8 (33.0) |        66.2 |                  6 |
| 4   | 0.6.7  |  14.5 |            16.6 (34.6) |        39.2 |                  2 |

¹ 2,448 reads failed in two bursts of a few seconds, all workers at once; the run did not keep the messages. Runs 3 and 4 kept them: one failure each, from Vision ("Cannot read image: Vision failed"; a read that passed the 120 s limit of `VisionWorker`).

What the runs show:

- **The pool that learns once keeps the size of its first measurement.** Runs 1 and 4 settled at 3 and 2 workers in the first phase, while workers still warmed up, and never measured again. After the contention ended, they still ran 3 and 2.
- **The pool that keeps learning corrects its size.** Runs 2 and 3 grew to 5 and 6 workers and read 1.5 times more images a second in the last phase.
- **Under contention, the Neural Engine is the limit.** Both processes together read about 51 to 75 images a second with either version. The pool that keeps learning takes a larger part: it does not let workers go for the other process, because each pool measures only its own jobs. A limit for the whole Mac needs one queue that all processes share (zukhruf #3527).
- **The first phase depends on the warm-up.** Runs 3 and 4 started slowly while other sessions built and tested on the Mac; the benchmark killed 104 and 477 foreign Vision helpers in those runs.

## Method

- **Variants.** One CLI build for all runs (`apps/cli/dist`, unchanged during the runs). For B, a Node resolve hook (`module.registerHooks`) sent each `@zukhruf/pool` import to an installed 0.6.14 outside the repository, and printed the version it loaded. The CLI and the transcription connector are the only modules that load the pool at run time.
- **Input.** The live WhatsApp store, not a frozen copy. The output of all runs was the same, so the store did not change during the runs.
- **Output.** A new `--directory` for each run, with `setup --connector whatsapp`, then `--transcription-model off sync --connector whatsapp --json`. The benchmark deleted each directory after it counted the output.
- **Other helpers.** Before each run, and at each sample during it, the benchmark killed every Vision helper that the run did not start. Only the Context Compiler desktop app started one again.
- **Sampling.** Every 250 ms, `ps` gave the Vision helpers that descend from the run, and the others.

## Limits

- Four runs for each version of the CLI import and two for each version of the long-lived pool, on a Mac that ran other sessions' builds and tests.
- All runs ended with status `partial`: the stream `groupMembersChanges` returned one row twice in one scan (elt #3608). The other 31 streams and the attachments loaded. elt 2963d54f fixed #3608 on 2026-11-04, after these runs.
- The helper count counts live processes. A step with fewer workers keeps every worker alive, so it does not show in the count.
