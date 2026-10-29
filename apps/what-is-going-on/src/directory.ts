import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const directory = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
  'what-is-going-on',
);
await mkdir(directory, { recursive: true });

export default directory;
