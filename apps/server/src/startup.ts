import { fileURLToPath } from 'node:url';

import { HillClimbing, LeaderFirst, Pool } from '@workspace/pool';
import { VisionWorker } from '@workspace/source-apple-macos/vision';

// Start recognition while the server registers its tools. Reads wait for a
// ready worker; closing MCP also stops a worker still warming up. The CLI
// builds the same pool: change both.
export const ocr = new Pool({
  size: new HillClimbing({ memoryPerWorker: VisionWorker.memory }),
  startup: new LeaderFirst(),
  create: () =>
    new VisionWorker(fileURLToPath(new URL('vision-worker', import.meta.url))),
});
