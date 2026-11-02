import { type Choice, byId } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';
import type { Source } from '@workspace/elt';
import type { ChromiumBrowser } from '@workspace/sdk-chromium-browser';
import type { ImportScope } from '@workspace/source-apple-macos/import-scope';
import { ChromiumSource } from '@workspace/source-chromium-browser/chromium-source';

// A Chromium browser on this Mac. Its history, downloads, searches and
// bookmarks are in the profile files every Chromium browser keeps, which
// ChromiumSource reads; what the browser keeps of its own, its own sources
// read beside it.
export abstract class ChromiumConnector extends Connector {
  readonly datedBy = 'visit time';
  readonly fullDiskAccess = false;
  protected readonly choices: readonly Choice[] = [
    {
      stream: 'profiles',
      scope: 'collectionIds',
      title: 'profiles',
      id: byId,
      // A profile folder that Local State does not list has no name.
      label: (row) => (row.name === null ? String(row.id) : String(row.name)),
    },
  ];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];
  protected abstract readonly browser: ChromiumBrowser;

  // The sources of what the browser keeps of its own, beside Chromium's.
  protected abstract ownSources(scope: ImportScope): readonly Source[];

  protected access(): string {
    return `${this.browser.name} needs no access granted: the import reads the profiles it keeps in your Library folder, also while it runs.`;
  }

  protected sources(scope: ImportScope) {
    return [
      new ChromiumSource({
        browser: this.browser,
        home: this.host.home,
        scope,
      }),
      ...this.ownSources(scope),
    ] as const;
  }
}
