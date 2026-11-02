import { ChromiumConnector } from '@workspace/connector-chromium/chromium-connector';
import { chrome } from '@workspace/sdk-chromium-browser';

export default class ChromeConnector extends ChromiumConnector {
  protected readonly browser = chrome;
  override readonly note =
    'Profiles select every stream. Dates select history visits only. Chrome removes history older than 90 days; the import keeps the visits it loaded before.';

  // Chrome keeps nothing of its own beside the Chromium profile files.
  protected ownSources() {
    return [];
  }
}
