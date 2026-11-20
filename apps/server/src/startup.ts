import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  HillClimbing,
  IdleTimeout,
  LeaderFirst,
  Pool,
  PoolWorkers,
  computerStore,
} from '@zukhruf/pool';

import { VisionWorker } from '@eltjs/source-apple-macos/vision';
import { visionKind } from '@eltjs/source-apple-macos/vision-kind';

// The store that every program on this Mac sends its pool jobs to.
export const poolStore = computerStore(process.env);

// Start recognition while the server registers its tools: the server offers
// Vision workers to every program on this Mac, and the owner that the
// election picks runs every read. Reads wait for a ready worker; closing MCP
// also stops a worker still warming up. The CLI builds the same pool: change
// both.
export const visionWorkers = new PoolWorkers({
  kind: visionKind,
  store: poolStore,
  clock: globalThis,
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
  create: () =>
    new VisionWorker(
      fileURLToPath(new URL('vision-worker', import.meta.url)),
      globalThis,
    ),
});

export const ocr = new Pool({
  kind: visionKind,
  store: poolStore,
  clock: globalThis,
});
