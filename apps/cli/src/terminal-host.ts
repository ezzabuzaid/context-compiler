import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DocumentParser } from '@eltjs/elt';
import { type GoogleRequester, googleSession } from '@eltjs/google-auth';
import type { ConnectorHost } from '@workspace/connector/connector';

import { GoogleClientFile } from './google-client-file.ts';

// The CLI as the host of the connectors: Google content is read with the
// user's own OAuth client, from the CLI's configuration folder.
export class TerminalHost implements ConnectorHost {
  readonly #parser: () => DocumentParser;
  readonly clock = globalThis;

  constructor(parser: () => DocumentParser) {
    this.#parser = parser;
  }

  get documentParser(): DocumentParser {
    return this.#parser();
  }

  readonly home = homedir();

  readonly env = process.env;

  readonly eventKitHelper = fileURLToPath(
    import.meta.resolve('@eltjs/sdk-apple-eventkit/eventkit-helper'),
  );

  // The CLI's configuration folder, which holds the Google client and the
  // session it signs in.
  readonly #config = join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'context-compiler',
  );

  readonly #googleClient = new GoogleClientFile(this.#config);

  async google(scopes: readonly string[]): Promise<GoogleRequester> {
    return googleSession({
      ...(await this.#googleClient.read()),
      scopes,
      directory: this.#config,
      clock: globalThis,
    });
  }
}
