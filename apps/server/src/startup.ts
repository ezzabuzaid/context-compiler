import { fileURLToPath } from 'node:url';

import { Vision } from '@workspace/source-apple-macos/vision';

// Start recognition while the server registers its tools. Reads wait for the
// worker's real OCR warm-up; closing MCP also stops a worker still warming up.
export const vision = new Vision(
  fileURLToPath(new URL('vision-worker', import.meta.url)),
);
