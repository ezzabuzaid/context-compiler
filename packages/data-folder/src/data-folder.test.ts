import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { TemporaryFiles } from '@zukhruf/testing/fs';

import { dataFolder } from './data-folder.ts';

test('the folder is made under XDG_DATA_HOME, with the folders above it', async () => {
  await using root = await new TemporaryFiles().directory('data-folder-');
  const home = join(root.path, 'missing', 'data');

  const folder = await dataFolder('probe', { XDG_DATA_HOME: home });

  assert.equal(folder, join(home, 'probe'));
  assert.ok((await stat(folder)).isDirectory());
});

// The home folder comes from HOME of the process (os.homedir), so a node of
// its own with a temporary HOME asks for the folder, as an app does.
test('without XDG_DATA_HOME, the folder is made under ~/.local/share', async () => {
  await using root = await new TemporaryFiles().directory('data-folder-');

  const { stdout: folder } = await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { dataFolder } from '@workspace/data-folder'; process.stdout.write(await dataFolder('probe', process.env));",
    ],
    { cwd: import.meta.dirname, env: { HOME: root.path } },
  );

  assert.equal(folder, join(root.path, '.local', 'share', 'probe'));
  assert.ok((await stat(folder)).isDirectory());
});
