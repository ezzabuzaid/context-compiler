# Vision startup and first-request initialization

Measured on 2026-10-24 on this Mac: macOS 27.0 (26A428), arm64, Node 26.10.0.

**Starting the process and loading Vision did not perform the expensive
initialization observed during the first OCR request. Running OCR before
accepting the target image reduced its measured latency.**

## Initial observation

| Step | Time |
| --- | ---: |
| Start the worker and receive its ready message | 67.36 ms |
| Import Vision and ImageIO | 4.71 ms |
| First OCR | 35,692.29 ms |
| Same image again | 227.69 ms |
| Same image a third time | 198.93 ms |

All three results matched the previously imported text exactly. A one-second
stack sample during the first request showed:

```text
VNRecognizeTextRequest
  → TextRecognition
  → Espresso prepare_compiler_if_needed / build
  → _ANEClient doLoadModel
  → _ANEDaemonConnection loadModel
  → synchronous XPC reply wait
```

This establishes model-loading work during OCR, after framework import had
returned. It does not measure the complete distribution of model-loading cost.
OS and Vision caches were not reset; this was not a controlled cold-cache run.
The sample itself may have affected the observed duration.

The temporary probe initially failed to exit after these three completed
measurements: JXA returned `NSData.length` as the string `"0"`, so the probe's
strict comparison with numeric zero kept its input loop running. A separate
Foundation-only probe confirmed that type. Only that owned worker was stopped;
the check became `Number(data.length) === 0` before the comparison below. This
was a probe shutdown error, outside the measured OCR calls and outside product
code. All comparison workers subsequently exited normally.

## Controlled process-lifecycle comparison

Six trials per variant, with variant order rotated on each trial. Each trial
used the same target image across all four variants. Four real imported images
were selected: two text-bearing JPEGs, a WebP sticker, and a `.thumb` image.
The two JPEGs were each used in two trials; the other images in one each.

| Work completed before the target image arrives | Median first target OCR | Median repeated target OCR |
| --- | ---: | ---: |
| Import Vision and ImageIO | 239.48 ms | 142.65 ms |
| Also construct/configure the recognition request | 247.82 ms | 146.26 ms |
| Also leave the constructed request idle for five seconds | 276.74 ms | 147.97 ms |
| Also perform OCR on a different image | 148.13 ms | 139.81 ms |

These first-target timings exclude work performed before the target arrived.
Each variant read the target three times. Variants that constructed a request
beforehand used it for their first OCR; subsequent requests were newly
constructed, as in production. Warm-up used a different image from the same
four-file set.

Across the 24 fresh worker processes, median process startup was **36.55 ms**,
framework import **1.80 ms**, and request construction/configuration **1.46 ms**.
The current production `ImageFormat.text()` was also called 18 times, launching
one process per image; its median complete call took **261.87 ms**.

Performing OCR as warm-up reduced the median first-target latency by **38.1%**
relative to loading the frameworks alone. Construction and five seconds of
idle time did not improve the first-target timing in these trials.

Warm-up has a cost: its six OCR calls took 232, 144, **15,969**, 298, 228 and
126 ms. The slow call was the first use of the thumbnail in this probe. Its
cause was not separately sampled, so it is not attributed to a particular
language, image shape, or model. The results do not establish that a single
warm-up image prepares every possible image path.

## Output verification and scope

The comparison completed **96 OCR calls**: 72 target calls, six warm-up calls,
and 18 calls through the current production implementation. Every returned
string matched the saved import's text by SHA-256. All used accurate recognition
and automatic language detection. The persistent probe evaluated the existing
`ImageFormat` recognition body, adding only request reuse for its construction
variant and the command/timing boundary.

The 35.69-second initial observation is recorded separately from those trials.
No image bytes, OCR text, native WhatsApp data, or import/checkpoint rows were
changed. Recognition was serial in this probe; it does not measure the full
import's four-way concurrency or establish an end-to-end speedup.

The lifecycle supported by these measurements is: start a persistent worker
with the host, perform a real OCR warm-up before declaring that tested path
ready, reuse the worker, and close it with the host. Startup and warm-up move
initial work earlier; they do not erase that work. No production change was
made. All probe workers exited; the pre-existing Apple service was untouched.

[Measurements](probes/vision-startup-results.json) contain per-call timings,
output hashes, process IDs, source identity and comparison summaries.
Follow-up remains backlog **#2916**.
