import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

import { LeaderFirst, Pool } from '@workspace/pool';
import {
  VisionWorker,
  visionConcurrency,
} from '@workspace/source-apple-macos/vision';

// Start recognition while the server registers its tools. Reads wait for a
// ready worker; closing MCP also stops a worker still warming up. The CLI
// builds the same pool: change both.
export const ocr = new Pool({
  size: visionConcurrency(availableParallelism(), process.availableMemory()),
  startup: new LeaderFirst(),
  create: () =>
    new VisionWorker(fileURLToPath(new URL('vision-worker', import.meta.url))),
});
