import { dia } from '@eltjs/sdk-chromium-browser';
import type { ImportScope } from '@eltjs/source-apple-macos/import-scope';
import { DiaDesktopSource } from '@eltjs/source-dia-desktop/dia-desktop-source';
import { ChromiumConnector } from '@workspace/connector-chromium/chromium-connector';

export default class DiaConnector extends ChromiumConnector {
  protected readonly browser = dia;
  override readonly note =
    'Profiles select every stream. Dates select history visits and archived tabs. Dia keeps its open tabs and its assistant chats in encrypted databases, which the import does not read.';

  // The tabs Dia archived, which only Dia keeps.
  protected ownSources(scope: ImportScope) {
    return [new DiaDesktopSource({ home: this.host.home, scope })];
  }
}
