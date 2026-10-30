import { watchStartupCredits } from './startup-credits.ts';

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The app keeps its files under XDG_DATA_HOME, as What is going on does
// (a copy: docs/copied-code.md).
const directory = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
  'startup-credits',
);
await mkdir(directory, { recursive: true });

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => stop.abort());

// GitHub lists of startup credit programs; the second links most programs'
// own pages, the first links more companies (#3352).
await watchStartupCredits({
  lists: [
    'https://github.com/avinash201199/awesome-startup-credits',
    'https://github.com/doanbactam/awesome-builder-programs',
  ],
  directory,
  log: (line) => console.log(line),
  signal: stop.signal,
});
