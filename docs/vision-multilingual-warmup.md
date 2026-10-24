# Multilingual OCR warm-up — #2921

The native elt worker now recognizes eight rendered language samples before
publishing readiness: English, Arabic, Hindi, Korean, Russian, Thai, Chinese
and Japanese. It uses the same `VNImageRequestHandler(url:)` decoder as imported
images. Automatic language detection and accurate recognition remain enabled.
The MCP server still owns worker startup, reuse and shutdown; no host lifecycle
or WhatsApp extraction behavior changed.

**Final fresh WhatsApp pass: 46.68 seconds, including process startup and
shutdown, with transcription off.** Warm-up inside that pass took 0.77
seconds and overlapped the data import. All 795 file results matched the prior
successful import exactly, including extracted-text hashes and parser/status.
There were 342,768 written rows, 32 successful streams and zero attachment errors.
All 62 voice files remained unsupported with no transcript. Settings were unchanged.

The earlier successful English-only warm-cache control took 44.88 seconds. This
does not establish a warm-throughput speedup. The improvement proved here is
broader recognition work before readiness. Apple's model caches were not reset;
these full-pass results are not controlled cold-start comparisons. A first native
test after rebuilding waited about 68 seconds while Apple's compiler worked;
that cost is real and is not represented by the later warm-cache startup timing.

## Regression evidence

The tests use the previously agreed real parser and MCP lifecycle boundaries.
No Vision mocks, language restrictions, new worker protocol or timing thresholds
were introduced.

- Before editing production code, the existing four parser tests passed. The
  new multilingual parser test also passed on the old worker: it is behavior
  preservation coverage, not evidence of the startup defect.
- A live readiness probe launched the old worker without sending any image
  requests, waited for ready, closed stdin, and inspected that process's native
  language initialization records. Its assertion failed: only `en` was present.
  The final worker passed with `en`, `ar`, `hi`, `ko`, `ru`, and `th` initialized
  before ready. The worker additionally checks exact recognition of all eight
  rendered samples. This native-log probe is diagnostic evidence, not a portable
  unit test or an assertion that every possible model path is loaded.
- The new parser regression checks exact text in all eight languages and reuse
  of the same worker. All five native parser tests passed, including existing
  blank/corrupt image, cancellation, concurrent response and crash recovery cases.
- The first implementation used named temporary PNGs. The real MCP shutdown
  regression failed on stdin close and SIGTERM because files survived interrupted
  warm-up. Both cases pass after using `tmpfile()` and its `/dev/fd` URL. The
  installed macOS `tmpfile(3)` API unlinks the file before returning; the OS
  releases it when the last descriptor closes, including process termination.

## Full-pass measurement

The generated WhatsApp directory and checkpoints were removed before each pass;
the source WhatsApp store and other connectors were left intact. The command was:

```sh
node apps/cli/dist/main.js \
  --directory "$HOME/Library/Application Support/Context Compiler/Imports" \
  --transcription-model off sync --connector whatsapp --json
```

Wall time runs from immediately before spawning Node until it exits. A temporary
preload listener recorded the native worker's first stdout response, then detached;
it changed no requests, OCR options or outputs. This adds small observation
overhead. The final data report arrived at 25.49 seconds; the remaining
21.19 seconds covered attachment completion and shutdown. Warm-up is already
inside total wall time, so adding it again would double-count it.

The preliminary multilingual implementation completed a full matching pass in
44.86 seconds, including its 0.93-second warm-up. The final run above includes
the anonymous-file cleanup correction.

One new pre-change baseline is excluded: 35.91 seconds with 122 failed images.
Native logs recorded E5RT compute-operation creation error 13. A later owned test
worker waited inside Apple's Neural Engine compilation IPC; the shared compiler
process had been alive about an hour and was using about 98% CPU when inspected.
It subsequently finished and tests passed. The authorized termination attempt
was denied because it was root-owned; no service restart occurred. This evidence
was appended to existing elt #2896. There was about 17 GB free, so low disk alone
does not explain the observations.

## Removal and scope audit

- **Removed:** the English-only, in-memory warm-up. The multilingual loop reuses
  the existing recognition function. Also removed the intermediate named-file
  cleanup mechanism; the OS now owns file lifetime. Output parity and shutdown
  regressions are the executed proof.
- **Net delta:** 60 lines added / 13 removed (net +47) in source/tests; 217 lines added / 0 removed in these two evidence
  files. This is additive because it broadens startup coverage and records
  regression and benchmark evidence; it adds no framework, package or public API.
- **Retained:** the native helper, exact-sample readiness check, image metadata
  handling, small-image guard, accurate recognition, automatic detection, error
  semantics, serial request queue, timeout and MCP lifecycle. These serve current
  parser and host consumers. Six public constructor call sites were checked:
  `apps/cli/src/main.ts`, `apps/server/src/startup.ts`, two in elt's
  `packages/sources/apple/macos/src/image-format.test.ts`, and one each in
  `packages/connectors/connector/src/transcription.test.ts` and
  `packages/connectors/instagram/src/instagram-connector.test.ts`.
- **Discovery:** inspected the installed Vision headers and package exports.
  `supportedRecognitionLanguages()` enumerates support; it does not perform OCR.
  No public warm-up/precompile API was found. `recognitionLanguages` and
  `usesLanguageCorrection` configure recognition and were not changed. The URL
  handler and standard-library `tmpfile()` provide the required mechanisms.
- **REJECTED:** a worker pool, language allow-list, skipped attachments, timing
  assertions against warm OS caches, extra readiness protocol fields, generic
  warm-up configuration, and automatic retries. They are unnecessary for this
  scope or would change output/error behavior. Two-worker throughput is tracked
  separately as elt #2922, supported by the earlier all-image experiment.
- **Unproven:** controlled cold-start speedup, all possible language/model paths,
  and native execution on Intel. Both architectures compiled; execution was on
  Apple Silicon. The tests do not make the intermittent Apple runtime issue #2896
  disappear.
- **Unresolved:** none within #2921. The separate native failure and throughput
  items remain open. Temporary probe programs and owned warm-up files were removed;
  aggregate evidence and private raw logs were retained. No process was left running.

Validation used `nx run source-apple-macos:test`, the filtered `server:test`,
both projects' `typecheck` targets, and `nx run-many -t build` in elt (65 projects).
The host bundle cache did not notice the changed sibling-repository binary, so
the final MCP test used `--skipNxCache`; SHA-256 hashes then matched across elt,
the server bundle and the plugin bundle. No cache configuration was changed.

[Aggregate measurements](probes/vision-multilingual-warmup-results.json) contain
counts and timings without private message text. Raw local evidence is under
`/tmp/cc2921`.
