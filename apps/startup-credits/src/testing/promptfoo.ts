import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// promptfoo's command line, beside its main module (dist/src/index.js).
const entrypoint = join(
  dirname(fileURLToPath(import.meta.resolve('promptfoo'))),
  'entrypoint.js',
);

// Runs promptfoo's command line in a test's own folder, with only what
// promptfoo needs: its data folder in the folder, so a second command of the
// same folder (promptfoo retry) reads the eval of the first, nothing sent
// out, and every OpenAI URL at a closed port. imports are loaded into
// promptfoo's process before promptfoo (the stub of an endpoint at the
// wire), and env adds what the harness reads (its login or key). Rejects
// when promptfoo exits with an error, with its stdout and stderr.
export async function promptfoo(
  folder: string,
  args: readonly string[],
  {
    imports = [],
    env = {},
  }: {
    readonly imports?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
  } = {},
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return promisify(execFile)(
    process.execPath,
    [...imports.flatMap((file) => ['--import', file]), entrypoint, ...args],
    {
      cwd: folder,
      timeout: 120_000,
      env: {
        PATH: process.env['PATH'],
        HOME: folder,
        PROMPTFOO_CONFIG_DIR: join(folder, '.promptfoo'),
        PROMPTFOO_DISABLE_TELEMETRY: '1',
        PROMPTFOO_DISABLE_UPDATE: '1',
        PROMPTFOO_DISABLE_SHARING: 'true',
        PROMPTFOO_PASS_RATE_THRESHOLD: '0',
        OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
        ...env,
      },
    },
  );
}
