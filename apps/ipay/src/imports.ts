import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { openReader } from '@zukhruf/sqlite-reader';

// Where Context Compiler keeps its files in this home folder, as its CLI and
// server do. ipay keeps its own files in a folder beside its imports.
export const contextCompiler = join(
  homedir(),
  'Library/Application Support/Context Compiler',
);

// The connectors whose imports ipay reads: Mail for receipts and invoices,
// Messages for the bank's texts.
export type ImportConnector = 'mail' | 'messages';

// The user has not set up a connector that ipay reads, or Context Compiler has
// not imported it yet; only the user can fix it, in Context Compiler.
export class ImportUnavailableError extends Error {
  constructor(connector: ImportConnector) {
    super(
      `Context Compiler has no ${connector} import: set up ${connector} in Context Compiler and sync it`,
    );
    this.name = 'ImportUnavailableError';
  }
}

// The data.sqlite of each import ipay reads, from selected_connectors, the
// reader view Context Compiler keeps in its settings for every reader. ipay
// only reads: the settings file belongs to Context Compiler.
export function importPaths(): Readonly<Record<ImportConnector, string>> {
  const settings = join(contextCompiler, 'Imports/settings.sqlite');
  using database = openReader(settings);
  const rows = database
    .prepare(
      "SELECT connector, database FROM selected_connectors WHERE connector IN ('mail', 'messages')",
    )
    .all();
  const path = (connector: ImportConnector) => {
    const row = rows.find((row) => row.connector === connector);
    if (row === undefined || typeof row.database !== 'string')
      throw new ImportUnavailableError(connector);
    return join(dirname(settings), row.database);
  };
  return { mail: path('mail'), messages: path('messages') };
}
