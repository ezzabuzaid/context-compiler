import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Makes the folder `name` under the user's data home and gives its path. The
 * data home is `XDG_DATA_HOME` of `env`, or `~/.local/share` when that is not
 * set (XDG Base Directory Specification).
 */
export async function dataFolder(
  name: string,
  env: { readonly XDG_DATA_HOME?: string },
) {
  const folder = join(
    env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    name,
  );
  await mkdir(folder, { recursive: true });
  return folder;
}
