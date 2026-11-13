import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DocumentParser } from '@eltjs/elt';
import { type GoogleRequester, googleSession } from '@eltjs/google-auth';
import type { ConnectorHost } from '@workspace/connector/connector';

// The CLI as the host of the connectors: macOS grants access to the program
// the entry point names, and Google content is read with the user's own OAuth
// client.
export class TerminalHost implements ConnectorHost {
  readonly #parser: () => DocumentParser;
  readonly grantee: string;
  readonly clock = globalThis;

  constructor(parser: () => DocumentParser, grantee: string) {
    this.#parser = parser;
    this.grantee = grantee;
  }

  get documentParser(): DocumentParser {
    return this.#parser();
  }

  readonly home = homedir();

  readonly env = process.env;

  readonly eventKitHelper = fileURLToPath(
    import.meta.resolve('@eltjs/sdk-apple-eventkit/eventkit-helper'),
  );

  google(scopes: readonly string[]): Promise<GoogleRequester> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      throw new Error(
        "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET for Calendar's Drive/Gmail attachments.",
      );
    return googleSession({
      clientId,
      clientSecret,
      scopes,
      directory: join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
        'context-compiler',
      ),
      clock: globalThis,
    });
  }
}
