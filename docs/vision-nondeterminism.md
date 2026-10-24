# OCR variation originates inside Apple Vision

The text variation reproduces in a standalone Swift program calling Apple
Vision, with no Context Compiler code, worker protocol, queue, warm-up or database.
It also occurs with **one process**. A larger worker pool is not necessary for
this failure, and keeping five workers is not a remedy for it.

The investigation ran on an Apple M4 Pro, 48 GiB RAM, 14 available CPUs,
macOS 27.0 build 26A428, Node 26.10.0. Four images that varied in the previous
comparison were read repeatedly. SHA-256 checks held their bytes fixed.

## Proof at the two boundaries

The standalone probe loads each image into immutable `Data`, creates a fresh
`VNRecognizeTextRequest`, sets `.accurate` and automatic language detection,
and calls `VNImageRequestHandler.perform` synchronously. Immediately afterward,
it saves the raw bounding boxes and top three text candidates into that process's
own output file. A second set of runs uses the same URL initializer as production.
There is no request/response transport that could misassociate these results.

| Standalone Vision, automatic compute selection     | Reads | Changed text |
| -------------------------------------------------- | ----: | -----------: |
| One process, fixed in-memory bytes, two runs       |   240 |            1 |
| Fourteen processes, fixed bytes, two runs          |   560 |            2 |
| Fourteen processes, production URL input, two runs | 2,240 |            3 |

In the one-process witness, PID 14562 read image SHA-256
`dfa407ab161111b0b22cde46019aa9ce3bc4511b4070feecd9a082666d4c1416`
at iterations 3 and 99. All **19 bounding boxes were exactly equal**, but the top
candidate changed in three places, including `100:05` becoming `1 00:05`.
Those two candidates exchanged their order even though both carried confidence
`1.0`. Another line changed from `TE 00:12` to `TET 0012`. The native observations
already contain these changes; joining strings is not their origin.

The URL probe also reproduced the **original Arabic failure** from the earlier
comparison: `إستروَ جيري هيكسْ` became `إسترو جيري هيكس`, losing two diacritics.
The image bytes and request settings did not change. This happened before
Context Compiler's native helper or TypeScript handling entered the picture.

The production audit then used the real `ImageFormat → Vision → vision-worker`
path. A temporary Node load hook changed only the pool size for the fourteen-worker
case. Instrumentation recorded each native input path and output response,
asserted at most one in-flight request per child, and compared the complete
multiset of public `(path, text)` results with the native `(path, text)` responses.
This checks cross-image association and exact text preservation, including repeats.

| Real production parser | Reads | Changed from earlier text | Pipe/result mismatches |
| ---------------------- | ----: | ------------------------: | ---------------------: |
| Fourteen workers       | 1,120 |                         2 |                      0 |
| Current five workers   | 1,120 |                         0 |                      0 |

The two changed production results were the same Arabic variant seen in the
standalone probe. Our worker handling returned Apple's result unchanged.
This proves the observed failure does not require a bug in our queue or protocol;
it does not claim that every possible cancellation or crash path was exercised.

## Compute-device controls

The installed Apple SDK exposes a main compute stage supporting CPU, GPU and
Neural Engine. The probe assigned each through `setComputeDevice(_:for:)`,
leaving recognition level, language detection and language correction unchanged.
The public API reports the **configured** device; an automatic assignment does
not reveal which hardware actually executed an internal model.

| Configured main compute stage | Reads | Changed text |
| ----------------------------- | ----: | -----------: |
| Automatic                     | 3,040 |            6 |
| CPU                           | 1,480 |            0 |
| GPU                           | 1,480 |            0 |
| Neural Engine                 | 1,480 |            0 |

Automatic URL runs bracketed the larger pinned-device controls and varied on
both sides. This makes automatic device selection a useful lead. It does **not**
identify Apple's internal defect, establish that hardware switching occurred,
or prove that a pinned device will always be stable. The public evidence cannot
distinguish internal scheduling, candidate ranking, numerical variation or
another Vision implementation detail. No pinned-device workaround was shipped.

Apple's [compute-device API](<https://developer.apple.com/documentation/vision/vnrequest/setcomputedevice(_:for:)>)
and the local Xcode `VNRequest.h` describe this assignment boundary. The probe
recorded revision 3, automatic language detection enabled, language correction
enabled and the default `en_US` language list for every run.

## Worker sizing

When a user's Mac has fewer resources, OCR should use fewer resources. The earlier
fixed five-worker recommendation is withdrawn. Available CPU count alone also
misses the cost observed in the previous full pass: fourteen workers used about
1.35 GiB more summed RSS for a 0.81-second improvement on this machine.

Elt's `Vision` owns recognition concurrency and can inspect device resources.
The MCP server and CLI own its lifetime. `AttachmentText` owns admission of all
attachment formats; it should not independently encode a machine-specific OCR
worker count. A portable sizing policy needs available CPU and memory capacity;
this investigation does not invent a cross-device formula from one Mac's results.
The current cap remains in code until that policy is implemented and tested.

## Reproduction evidence and scope

[Aggregate results](probes/vision-nondeterminism-results.json) include all run
counts, hashes, the single-process candidate witness, and the exact standalone
Swift source used for the URL and device-control runs. To repeat it, compile that
source with `xcrun swiftc -O`, pass a JSON array of `{ "path": "/absolute/image" }`,
an output JSON path, mode (`default`, `cpu`, `gpu`, `neuralEngine`, optionally
prefixed with `url-`) and a read count. Each process records its own observations.
Repetition is diagnostic; the rare variation is not a deterministic CI assertion.

Raw observations and production pipe audits remain at `/tmp/cc-ocr-cause`.
The repository evidence contains no private image paths or complete image text.
The first single-process run waited in Apple's Neural Engine compiler and took
66.92 seconds; its second run took 11.31 seconds. Neither is a full-import timing.
The compiler finished without intervention. RSS samples can double-count shared
pages and omit Apple services; they do not measure unique system-wide memory.

No production sources, built modules, helper binaries, stored imports or settings
changed. Source/binary hashes matched before and after the probes. Transcription
was never invoked. All 169 tracked probe, worker and controller processes exited;
no other app or shared service was stopped. Only documentation and evidence were
changed, so Nx build/typecheck/test targets were not rerun. Other Macs, macOS
builds, recognition accuracy against a human transcript and a deterministic
compute-device fix remain untested.
