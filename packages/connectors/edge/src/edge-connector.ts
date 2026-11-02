import { ChromiumConnector } from '@workspace/connector-chromium/chromium-connector';
import { edge } from '@workspace/sdk-chromium-browser';

export default class EdgeConnector extends ChromiumConnector {
  protected readonly browser = edge;
  override readonly note =
    'Profiles select every stream. Dates select history visits only. Edge removes history older than 90 days; the import keeps the visits it loaded before.';

  // Edge keeps its Collections in a database of its own, which no source
  // reads.
  protected ownSources() {
    return [];
  }
}
