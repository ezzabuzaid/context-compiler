import { homedir } from 'node:os';
import { join } from 'node:path';

import { Command as Program } from 'commander';

import { builtInConnectors } from '@workspace/connector-manifest/built-in-connectors';
import { Connectors } from '@workspace/connector-manifest/connectors';
import { provideHostModules } from '@workspace/connector-manifest/host-modules';
import { userConnectors } from '@workspace/connector-manifest/user-connectors';

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
      program.error(error instanceof Error ? error.message : String(error)),
    );

const { connectors, broken } = await new Connectors([
  builtInConnectors,
  userConnectors,
]).load(new TerminalHost(() => parsing.parser));

for (const { title, error } of broken)
  process.stderr.write(`${title} could not be loaded: ${error}\n`);

const imports = new Imports(connectors, directory, parsing);

for (const command of [
  new SetupCommand(imports),
  new OptionsCommand(imports),
  new SyncCommand(imports),
  new StatusCommand(imports),
  new QueryCommand(imports),
])
  command.attach(program);
await program.parseAsync([...operands, ...unknown], { from: 'user' });
