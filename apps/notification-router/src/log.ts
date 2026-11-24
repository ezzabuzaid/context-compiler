import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { stateFolder } from './places.ts';

const file = join(stateFolder, 'router.log');

export function log(event: string, details: Record<string, unknown>): void {
  mkdirSync(stateFolder, { recursive: true, mode: 0o700 });
  appendFileSync(
    file,
    `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`,
  );
}
