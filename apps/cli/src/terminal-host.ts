import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DocumentParser } from '@eltjs/elt';
import { type GoogleRequester, googleSession } from '@eltjs/google-auth';
import type { ConnectorHost } from '@workspace/connector/connector';

import type { BackgroundWatch } from './background-watch.ts';

// The CLI as the host of the connectors: macOS grants access to the
// terminal that launched it, or to the node of the background watch once one
// is installed, and Google content is read with the user's own OAuth client.
export class TerminalHost implements ConnectorHost {
  readonly #parser: () => DocumentParser;
  readonly #background: BackgroundWatch;
  readonly clock = globalThis;

  constructor(parser: () => DocumentParser, background: BackgroundWatch) {
    this.#parser = parser;
    this.#background = background;
  }

  get documentParser(): DocumentParser {
    return this.#parser();
  }

  readonly home = homedir();

  readonly env = process.env;

  readonly eventKitHelper = fileURLToPath(
    import.meta.resolve('@eltjs/sdk-apple-eventkit/eventkit-helper'),
  );

  // The program macOS asks for access on behalf of. With a background watch
  // installed, that watch loads the imports, so it is the node launchd runs
  // for it. Otherwise it is the app that launched this process. TERM_PROGRAM
  // cannot name it; cmux, for one, reports ghostty. Spotlight answers only
  // when guidance is shown.
  get grantee(): string {
    const node = this.#background.node();
    if (node !== undefined) return node;
    const bundle = process.env.__CFBundleIdentifier;
    if (bundle !== undefined && /^[\w.-]+$/.test(bundle))
      try {
        const [path] = execFileSync(
          '/usr/bin/mdfind',
          [`kMDItemCFBundleIdentifier == '${bundle}'`],
          { encoding: 'utf8', timeout: 5_000 },
        ).split('\n');
        if (path) return basename(path, extname(path));
      } catch {
        // Spotlight is unavailable: name the app generically.
      }
    return 'your terminal app';
  }

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
