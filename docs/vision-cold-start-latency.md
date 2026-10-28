# OCR cold-start latency (#2896)

The earlier [deadline fix](vision-cold-start-timeout.md) stopped the host killing
workers during model compilation. It did not shorten initialization. This change
addresses a separate cause: a **cache stampede**, where simultaneous callers
independently rebuild the same missing cache entry.

## Cause and change

The native sample reaches `VNRecognizeTextRequest → MILCompilerForANE →
_ANEClient compileModel → synchronous XPC`. Different worker PIDs produced
byte-identical `model.mil` programs and `weights1.bin` inputs under the same model
cache keys. Their temporary bundle names identify the submitting PID. SHA-256
comparisons establish duplicate compilation inputs, beyond merely observing a
busy shared compiler.

Before implementation, four helpers using the unchanged recognition code and a
new process/cache identity took **194.62 seconds** to warm together. Four helpers
started sequentially in another empty cache namespace took **59.83 seconds** in
total: **58.04 seconds** for the first, then **0.60, 0.59 and 0.59 seconds**. Each
performed the same eight-script recognition checks. This is a process-namespace
cold-cache experiment, not a reboot or a reset of every Apple cache.

Elt's `Vision` pool first released native warm-up one worker at a time through
its stdin pipe, on every start. Only the first start after a new helper binary
needs that order: once the first worker compiles the models, the cache holds
them, and four workers that start together with a warm cache are each ready in
1.1–1.3 seconds, against 0.9 seconds for one worker alone. The chain made every
warm start wait for each worker in turn.

The hosts build an OCR pool from `Pool` (`@zukhruf/pool`)
with the `LeaderFirst` startup: the first worker starts alone, and the others
start together once it is ready. A replacement after a crash starts at once,
because the cache is warm. The pool also serves the local transcription engine.
The helper no longer waits for a startup line. The MCP server builds its pool
when it starts; the CLI builds its pools only for a sync or a watch.

Measurements on 2026-10-25, same M4 Pro, 325 WhatsApp images, four workers:

| Run                                     |       Ready |        Reads |
| --------------------------------------- | ----------: | -----------: |
| Chain, warm cache                       | 3.39–4.17 s | 8.90–12.15 s |
| `LeaderFirst`, warm cache               | 1.79–2.49 s |  7.08–8.80 s |
| `LeaderFirst`, new helper binary (cold) |     73.43 s |       6.89 s |

One Vision process does not replace the pool. With 1, 3, 6 and 14 images in
flight, one process read the same 325 images in 20–26 seconds; Vision runs its
requests mostly one at a time inside a process. Only more processes add speed.

## Regression and integration checks

The first regression uses the real AppKit image, native worker, `ImageFormat` and
`MacOSDocumentParser`. It pauses the first worker before readiness and requires
other workers to wait. Before implementation it failed: six reads completed
while the initializer was stopped. After implementation it passed. A second case
cancels a waiting initializer and queues its replacement while the first is
paused; neither later workers nor the replacement bypass it. Both cases resume
real recognition, verify literal text and check process reuse/replacement.

All **14 macOS source tests** passed, including eight-script text, concurrent
image processing, corrupt images, native crashes, read deadlines, cancellation
and disposal. The complete suite took 50.35 seconds after the native cache warmed.
The first focused cold run took 82.19 seconds, including its deliberate five-second
pause, fixture creation and seven workers. Both real bundled MCP lifecycle cases
passed: workers exist before tool use, survive transcription-setting changes,
and exit on stdin closure or SIGTERM.

`source-apple-macos:typecheck` passed formatter, lint and types. All 65 elt package
builds, the CLI build and an uncached plugin bundle passed. Inspection of the
emitted server chunk confirmed the readiness chain, and the bundled native
helper's SHA-256 matched the package helper. No new dependency, setting, retry,
worker cap, lock file or compatibility path was introduced.

## Full WhatsApp comparison

On this M4 Pro (14 available CPUs, 48 GiB RAM, macOS 27.0 build 26A428,
Node 26.10.0), the corrected controlled full pass fell from **208.21 to 97.93
seconds: 53.0% less elapsed time**. The pool was fully ready at 207.79 seconds
before the fix and 84.15 seconds afterward. The fixed first worker took 77.42
seconds; the following workers reused its compiled models. The smaller isolated
probe's 59.83-second result is not substituted for this loaded-machine result.

| Run                                       | Startup to exit | Ingestion | Workers | Last worker ready | Peak combined RSS |
| ----------------------------------------- | --------------: | --------: | ------: | ----------------: | ----------------: |
| Cold, simultaneous warm-up                |        208.21 s |   21.97 s |       4 |          207.79 s |           943 MiB |
| Cold, ordered warm-up                     |         97.93 s |   20.82 s |       4 |           84.15 s |         1,032 MiB |
| Production helper, compiled cache present |         55.10 s |   33.92 s |       4 |            6.61 s |         1,010 MiB |

The corrected cold comparison raised peak combined RSS by **89 MiB (9.5%)**.
The warm production pass used live device sizing; the controlled cold pair used
the same captured 10,274,996,224-byte memory budget. Its 55.10-second result is a
startup-inclusive repeat import, not a cold-cache result or evidence of a change
against earlier, differently loaded runs. System swap use rose during these runs;
the aggregate records it alongside available memory. These are individual runs
on an active machine, not a universal speed or memory estimate.

All three imports produced **345,272 identical source rows in 32 tables and 916
byte-identical attachments**, with zero failures and all **116 Opus voice files
untranscribed**. Loaded original JavaScript modules matched; only the deliberate
benchmark hooks differ. **910/916 text results matched baseline versus fixed.**
Six image texts differed, including one changing from null/no_text to text/parsed.
Attachment identities, bytes and parser assignments matched; that derived status
therefore did not match for one image. The cold fixed and warm production runs
matched **all 916 text values and statuses exactly**.

The six new image witnesses are recorded under existing #2942. This comparison
does not establish the internal cause for those particular images, and they have
not been replayed in a standalone native loop. Prior direct Apple Vision
reproductions establish the broader repeatability risk; this timing change does
not claim to solve it. Recognition settings are unchanged, and all literal
multilingual regression fixtures pass.

[Aggregate evidence](probes/vision-cold-start-latency-results.json) records the
measurements, output and source digests, duplicate compiler-input hashes and
excluded trials. The frozen input was captured at 2026-10-25T07:33:14.276Z: ten
SQLite backups plus 952 media files totaling 395,612,391 bytes.

The timer starts before spawning the real CLI and stops at process exit. It
includes module loading, worker startup, multilingual warm-up, ingestion,
attachment parsing and cleanup. Transcription is disabled. Each run starts with
an empty import and the same frozen input: ten online SQLite backups plus all
referenced files. Source scan time is fixed, input hashes are rechecked, and
stored attachment bytes are checked against their SHA-256. The probe asserts the
actual SDK container and all ten database paths opened. Row comparison reads
64-bit SQLite integers losslessly and excludes only generated `loaded_at`.

RSS is resident process memory. The combined peak samples the CLI and its OCR
workers together every 250 ms; their separate maxima need not occur together.
Shared pages can be counted twice, and GPU/native allocations outside these
processes are not included. The shared compiler is recorded separately. System
available memory and swap include other apps, so their changes cannot be
attributed to this import alone.

The cold baseline and candidate use separate empty cache namespaces and the same
native recognition source. A temporary Node load hook releases all baseline
initializers immediately, reproducing the old simultaneous warm-up. The candidate
uses the production ordering. The CPU count and one captured available-memory
value feed the unchanged device-sizing function in both cold runs. A subsequent
production-helper run uses the machine's live available memory and existing
compiled-model cache. This keeps the controlled comparison distinct from the
normal device-aware host measurement. Loaded module hashes and
helper hashes are recorded locally; production code has no benchmark switch.

An initial six-worker pair is excluded from the controlled comparison. The
harness overrode only the SDK constructor's default container, but the source
passed an explicit live container. Six new receipt rows exposed that mistake.
The corrected hook replaces the exported container location and asserts every
opened path. Those excluded runs took 321.66/69.99 seconds and matched all 916
attachment text values, but did not use frozen source databases. Their aggregate
records retain the exclusion reason; the table above uses the corrected runs.

## Limits

The first cold worker still pays Apple's native compilation cost. Sequencing
removes redundant work within one pool; it does not accelerate Apple's compiler
or coordinate independent hosts starting simultaneously. Other Mac models and
simultaneous cold host launches were not measured. Existing Apple Vision text
variation (#2942) and native E5RT failures remain separate risks; the recognition
policy is unchanged.

## Review and cleanup

This latency change adds a startup dependency and signal to the existing pool; it
introduces no new class, exported API or persistent state. Including the earlier
deadline fix, the production diff is 33 lines added/23 removed in vision.ts and
three lines added in main.swift. Five regression cases add 187 lines to the
existing test file (two cases/99 lines in this follow-up). Every changed source
file was read in full after the checks. Changes remain unstaged and uncommitted.

All owned workers exited. Temporary executables, their six task-specific cache
namespaces, frozen databases/media, import outputs and probe programs were
removed after saving the aggregates. Native diagnostic logs, private trace/hash
records and six small images (726,037 bytes total) remain under
/private/tmp/cc2896-latency for #2942. Existing production caches were preserved; the shared
ANECompilerService was not stopped.
