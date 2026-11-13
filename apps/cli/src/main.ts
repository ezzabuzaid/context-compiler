import { execFileSync } from 'node:child_process';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

import { Command as Program } from 'commander';

import { macOSAccess } from '@eltjs/sdk-macos-app-database';
import { builtInConnectors } from '@workspace/connector-manifest/built-in-connectors';
import { Connectors } from '@workspace/connector-manifest/connectors';
import { provideHostModules } from '@workspace/connector-manifest/host-modules';
import { userConnectors } from '@workspace/connector-manifest/user-connectors';

import { BackgroundWatch } from './background-watch.ts';
import { OptionsCommand } from './commands/options.ts';
import { QueryCommand } from './commands/query.ts';
import { SetupCommand } from './commands/setup.ts';
import { StatusCommand } from './commands/status.ts';
import { SyncCommand } from './commands/sync.ts';
import { Imports } from './imports.ts';
import { Parsing } from './parsing.ts';
import { TerminalHost } from './terminal-host.ts';

if (process.platform !== 'darwin')
  throw new Error('The connectors read apps on a Mac.');

// Node gives each address of a host 250 ms to connect, then drops it for the
// next. A connection that takes longer, as one to Google took 200 to 400 ms
// on a Mac whose network has no IPv6 route, then fails on every address.
// RFC 8305 allows such an attempt 2 seconds at most.
setDefaultAutoSelectFamilyAttemptTimeout(2_000);

// The program macOS charges what this process reads to, as System Settings
// lists it: the app that launched it, named by its bundle identifier, since
// TERM_PROGRAM cannot name it (cmux, for one, reports ghostty); or, when
// launchd started it, as it starts the background watch, the node it runs.
// launchd sets XPC_SERVICE_NAME to the job's label, and a terminal's child
// has 0. Otherwise the stores' errors name no program.
function responsibleProgram(): string | undefined {
  const bundle = process.env.__CFBundleIdentifier;
  if (bundle !== undefined && /^[\w.-]+$/.test(bundle))
    try {
      const [path] = execFileSync(
        '/usr/bin/mdfind',
        [`kMDItemCFBundleIdentifier == '${bundle}'`],
        { encoding: 'utf8', timeout: 5_000 },
      ).split('\n');
      return path ? basename(path, extname(path)) : undefined;
    } catch {
      // Spotlight is unavailable: the errors name no program.
      return undefined;
    }
  const service = process.env.XPC_SERVICE_NAME;
  return service !== undefined && service !== '0'
    ? process.execPath
    : undefined;
}
const grantee = responsibleProgram();
if (grantee !== undefined) macOSAccess.install({ program: grantee });

// The user's own connectors import elt and Connector from this CLI's copies.
provideHostModules(({ specifier }) => import.meta.resolve(specifier));

const program = new Program('context-compiler')
  .description(
    'Import the apps on this Mac, keep them current, and query them.',
  )
  .option(
    '--directory <path>',
    'directory for settings and imports',
    join(homedir(), 'Library/Application Support/Context Compiler/Imports'),
  )
  .option(
    '--transcription-model <id>',
    'file name of a speech model installed on this Mac, such as cohere-transcribe-arabic-07-2026-Q8_0.gguf, or off',
  )
  .showHelpAfterError()
  // Each command reads its own options, so sync watch --connector reaches
  // watch rather than sync.
  .enablePositionalOptions()
  .passThroughOptions();

// Read the storage option before constructing the commands' shared imports.
// Commander leaves the command and its arguments for the full parse below.
const { operands, unknown } = program.parseOptions(process.argv.slice(2));
const { directory, transcriptionModel } = program.opts<{
  directory: string;
  transcriptionModel?: string;
}>();
await using parsing = new Parsing(directory);
if (transcriptionModel !== undefined)
  await parsing
    .configure(transcriptionModel === 'off' ? null : transcriptionModel)
    .catch((error: unknown) =>
      program.error(Error.isError(error) ? error.message : String(error)),
    );

const background = new BackgroundWatch(directory, import.meta.filename);
// Setup text names the node, the program that runs this process, when no
// app or job is known.
const { connectors, broken } = await new Connectors([
  builtInConnectors,
  userConnectors,
]).load(new TerminalHost(() => parsing.parser, grantee ?? process.execPath));

for (const { title, error } of broken)
  process.stderr.write(`${title} could not be loaded: ${error}\n`);

const imports = new Imports(connectors, directory, parsing, background);

for (const command of [
  new SetupCommand(imports),
  new OptionsCommand(imports),
  new SyncCommand(imports),
  new StatusCommand(imports),
  new QueryCommand(imports),
])
  command.attach(program);
await program.parseAsync([...operands, ...unknown], { from: 'user' });
