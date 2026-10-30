import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const directory = join(import.meta.dirname, '../outputs');
await mkdir(directory, { recursive: true });

export default directory;
