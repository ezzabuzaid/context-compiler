# Full WhatsApp import without voice transcription

Measured on 2026-10-24, Node v26.10.0, macOS 27.0, using the built CLI and
the compact WhatsApp source from the sibling elt checkout.

**The fresh complete CLI run took 299.98 seconds. An immediate repeat took
4.10 seconds and wrote/deleted no rows.** Both exited with status 0.

This is an end-to-end benchmark: the CLI process starts, loads every selected
WhatsApp stream, copies attachments, commits records and checkpoints, extracts
supported attachment text, then exits. Voice transcription was disabled.

| Measurement                                              | Fresh import |   Repeat |
| -------------------------------------------------------- | -----------: | -------: |
| Complete CLI wall time                                   |     299.98 s |   4.10 s |
| Data pass, from persisted attempt timestamps             |     22.265 s |  3.307 s |
| After data-pass report until process exit                |    277.213 s |  0.073 s |
| Rows written                                             |      342,762 |        0 |
| Rows deleted                                             |            0 |        0 |
| Successful streams                                       |      32 / 32 |  32 / 32 |
| Maximum resident set size reported by `/usr/bin/time -l` |     910.1 MB | 699.1 MB |

The phase timings exclude CLI startup from the data-pass and post-pass rows;
they therefore do not sum exactly to total wall time. The post-pass interval
includes publishing views, attachment text processing and finalization.

## Freshness and scope

There was no existing WhatsApp selection or output folder in the shared store,
so nothing needed deleting. Setup added an unrestricted WhatsApp selection with
attachments enabled and preserved the other 14 connector selections. WhatsApp
was not watched. Transcription was already off and remained off.

The output is the actual shared import under
`~/Library/Application Support/Context Compiler/Imports/whatsapp/d58fec66e4f1d6c6`.
The CLI's resolved source and SDK paths were checked against the sibling elt
build, including the call to `reader.changes()` in the compact implementation.
The CLI build completed before timing. No source code changed for this run.

Fresh means empty generated output and checkpoints. Operating-system file
caches and Vision model caches were not cleared; this is one observed full
import, not a controlled cold-cache experiment.

The timed command for both passes was:

```sh
node apps/cli/dist/main.js \
  --directory "$HOME/Library/Application Support/Context Compiler/Imports" \
  --transcription-model off \
  sync --connector whatsapp --json
```

## Imported data and attachments

The 32 streams included 74,053 messages, 217,562 receipts, 17,301 reactions,
746 chats and the remaining contact, group, call, business, sticker and
settings records. All streams succeeded. The repeat found no changes.

There were **795 unique copied files, totaling 226,457,493 bytes**:

| Attachment text result                                      | Files |
| ----------------------------------------------------------- | ----: |
| Images with recognized text                                 |   236 |
| Images with no recognized text                              |   445 |
| PDFs with extracted text                                    |     7 |
| Text documents with extracted text                          |     3 |
| Unsupported formats, including audio with transcription off |   104 |
| Failures                                                    |     0 |

All **62 `.opus` voice files** were copied and recorded as `no_text` with parser
`unsupported`. None was transcribed. The final checkpoint JSON across all 32
streams was 67,501,024 bytes; the earlier 64.5 MB figure covered only the four
message-derived streams.

## Where the time went

The database and attachment-copy pass completed after 22.265 seconds. Most of
the total time followed it, while `AttachmentText` ran image recognition and
document extraction with its existing concurrency of four.

A one-second stack sample of an import-owned `osascript` showed:

```text
Vision / VNRecognizeTextRequest
  → TextRecognition
  → Espresso model compilation
  → _ANEClient compileModel
  → synchronous XPC reply wait
```

Apple's `ANECompilerService` used roughly one CPU core and predated the import.
No system or unrelated process was stopped. Progress accelerated substantially:
197 files were complete at 06:50:46 UTC, then 540 at 06:51:06 UTC. These are
observations supporting model compilation as part of the initial delay; they
do not establish that every OCR request recompiles, or that process reuse alone
would fix it. The one-second sample is part of this observational timing.

The follow-up, **context-compiler backlog #2916**, added startup warm-up and
process reuse; its measurements are below. It is separate from #2896's transient recognition failures; this run
had no failures. The unchanged repeat reused attachment text and spent only
0.073 seconds after its data-pass report.

[Aggregate measurements](probes/whatsapp-full-import-results.json) include the
commands, exit codes, persisted attempts, per-stream counts, attachment results
and resource measurements. They contain no message or extracted-text content.

## Persistent OCR worker rerun

On 2026-10-24 the same CLI command, with transcription off, was run against
an empty WhatsApp import and checkpoints in the shared store. Only that
connector's generated folder was removed. Selections, watch settings and
transcription settings remained unchanged.

| Measurement                                | Previous fresh pass | Persistent worker |
| ------------------------------------------ | ------------------: | ----------------: |
| Complete CLI wall time                     |           299.984 s |          92.607 s |
| Persisted data pass                        |            22.265 s |          27.616 s |
| After data-pass report until exit          |           277.213 s |          64.194 s |
| Maximum RSS reported by `/usr/bin/time -l` |            910.1 MB |          740.0 MB |
| Rows written                               |             342,762 |           342,768 |
| Successful streams                         |             32 / 32 |           32 / 32 |
| Attachment failures                        |                   0 |                 0 |
| Unchanged repeat, complete CLI wall time   |             4.097 s |           5.087 s |

The fresh pass used **69.1% less elapsed time (3.24 times as fast)**. The
unchanged repeat wrote and deleted zero rows. These are observations on the
same working Mac, not an isolated cold-cache experiment: OS file/model caches
were not reset, native tests and a standalone warm-up probe preceded this
run, and the live source had changed. The data phase and repeat were slower;
this result does not attribute every timing difference to the worker.

The output still contained 795 files: 236 images with text, 445 images without
text, seven PDFs with text, three text documents, and 104 unsupported files.
All 62 `.opus` files were `unsupported` / `no_text`.

All **794 identical input files** retained exactly the same extracted-text
SHA-256 and status. One message JPEG was replaced in the live source; its
bytes and recognized text differ from the old file. Its extracted text matched a separate run of the exact previous
ImageFormat recognition script on that new input. Three messages,
three receipts and one data item appeared, and one status disappeared.
The copied byte total was 226,433,484.

The standalone native warm-up took 0.147 s with the current OS caches. The
worker draws and recognizes a known text image before emitting its ready
response; merely launching it does not count as ready. Earlier probes and a
fresh native test launch observed roughly 32–36 seconds during initial model
preparation, so that cost has been moved to eager background startup, not
eliminated. MCP initialization can complete while warm-up runs; an image read
waits for it.

The MCP server creates the worker in `apps/server/src/startup.ts`, imported
first using the same Prettier import order as text2sql/datahub. Its existing
MCP SDK close callback disposes the worker on stdin EOF or process signals.
Desktop only owns its MCP server. The CLI owns the same library resource for
one invocation and disposes it on exit. Speech-model changes borrow the same
image reader and do not restart OCR.

Regression evidence:

- New real MCP regression failed before implementation: zero children before
  the first tool call. It now proves eager startup, reuse across enabling and
  disabling speech transcription, and worker exit on stdin EOF and SIGTERM.
- New real parser regression failed after a forced worker exit, then passed
  with recovery. It checks exact OCR text, concurrent calls, empty images,
  corrupt images and cancellation without module mocks.
- Existing Messages image/PDF/vCard tests, Mail tracking-pixel tests, the real
  Instagram attachment-text pipeline and the 21 connector tests passed.
- One valid-image fixture run returned `Cannot read image: Vision failed`;
  the unchanged rerun passed. This remains the existing transient Vision
  issue #2896. The full WhatsApp pass had no failed files.
- All 65 elt projects built. Nx formatter/linter/typecheck targets passed for
  source-apple-macos, source-apple-messages, source-apple-mail, connector,
  connector-instagram-web, server and cli. `--skipSync` preserved unrelated
  project-reference work reported out of sync by Nx.

Removal audit: per-image image `osascript` launches were removed; the previous
reader's full-input comparison and image regressions verify the replacement.
PDF `osascript`, image signatures, the small-image guard, attachment caching
and the existing 120-second OCR deadline remain. Terminus was rejected after
its HTTP-only lifecycle failed the stdio probe; the MCP SDK owns shutdown.
The change adds 537 and removes 70 source/configuration lines (net +467,
excluding generated lockfiles and this report): the native worker/protocol and
regressions replace a one-shot call. No generic worker framework or HTTP
listener was added. Probe scripts are removed after recording their results. Runtime verification
covered this arm64 Mac; the x86_64 helper compiled but was not executed. No
approval or implementation decision remains unresolved.

[Aggregate rerun evidence](probes/whatsapp-ocr-worker-results.json) contains
commands, timings, stream counts and comparison outcomes, without extracted
text or message contents.
