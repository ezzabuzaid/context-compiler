import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { pingTitle } from './notifications.ts';

const run = promisify(execFile);

/** Tells Ezz with a macOS notification; the text goes in as an argument, never as script. */
export async function ping(text: string): Promise<void> {
  await run('osascript', [
    '-e',
    'on run argv',
    '-e',
    `display notification (item 1 of argv) with title "${pingTitle}"`,
    '-e',
    'end run',
    text,
  ]);
}
