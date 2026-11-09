import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

import { HillClimbing, IdleTimeout, LeaderFirst, Pool } from '@zukhruf/pool';

import { VisionWorker } from '@eltjs/source-apple-macos/vision';

// Start recognition while the server registers its tools. Reads wait for a
// ready worker; closing MCP also stops a worker still warming up. The CLI
// builds the same pool: change both.
export const ocr = new Pool({
  size: new HillClimbing({
    memoryPerWorker: VisionWorker.memory,
    computer: {
      availableParallelism,
      availableMemory: () => process.availableMemory(),
    },
  }),
  startup: new LeaderFirst(),
  // Idle Vision workers close after 5 minutes, so a server that does no work,
  // such as one Codex keeps after a plugin refresh, holds no helpers (#3516).
  eviction: new IdleTimeout({ after: 300_000 }),
  clock: globalThis,
  create: () =>
    new VisionWorker(
      fileURLToPath(new URL('vision-worker', import.meta.url)),
      globalThis,
    ),
});
