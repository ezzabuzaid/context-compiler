import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import test from 'node:test';
import { stripVTControlCharacters } from 'node:util';

import { TemporaryFiles } from '@zukhruf/testing/fs';

// The app reads XDG_DATA_HOME once, at import, so its reader tests run in a
// child process that has a data folder of its own in its env; the child's
// report of each test shows in this run's output.
test('the reader tests pass with a data folder of their own', async () => {
  await using data = await new TemporaryFiles().directory('what-is-going-on-');
  // node:test marks its own test processes with NODE_TEST_CONTEXT, and a
  // node --test that inherits it skips its files as a recursive run.
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
  const cases = spawn(
    process.execPath,
    [
      '--test',
      '--test-reporter=spec',
      join(import.meta.dirname, 'testing/reader-cases.ts'),
    ],
    {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...env, XDG_DATA_HOME: data.path },
    },
  );
  let report = '';
  cases.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    report += chunk;
    process.stdout.write(chunk);
  });
  const [code] = await once(cases, 'exit');

  assert.equal(code, 0);
  assert.match(stripVTControlCharacters(report), /^ℹ tests [1-9]\d*$/m);
});
