import { ChromiumConnector } from '@workspace/connector-chromium/chromium-connector';
import { arc } from '@workspace/sdk-chromium-browser';
import type { ImportScope } from '@workspace/source-apple-macos/import-scope';
import { ArcDesktopSource } from '@workspace/source-arc-desktop/arc-desktop-source';

export default class ArcConnector extends ChromiumConnector {
  protected readonly browser = arc;
  override readonly note =
    'Profiles select every stream. Dates select history visits only. Arc keeps its bookmarks in its sidebar: spaces, pinned and unpinned tabs, folders, notes and favorites.';

  // Arc's sidebar, which only Arc keeps.
  protected ownSources(scope: ImportScope) {
    return [new ArcDesktopSource({ home: this.host.home, scope })];
  }
}
