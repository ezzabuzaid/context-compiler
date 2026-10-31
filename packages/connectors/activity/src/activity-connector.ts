import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';
import { biomeDirectory } from '@workspace/sdk-apple-biome';
import { knowledgeStorePath } from '@workspace/sdk-apple-knowledge';
import { AppleActivitySource } from '@workspace/source-apple-activity/apple-activity-source';

export default class ActivityConnector extends Connector {
  readonly datedBy = null;
  readonly fullDiskAccess = true;
  // macOS keeps a few weeks of activity; everything it keeps is imported.
  protected readonly choices: readonly Choice[] = [];
  // A small Biome stream: reading it lists the protected Biome folder.
  protected override readonly probe = 'appMenuItems';
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(): string {
    return 'No app needs to be open: macOS records this activity on its own.';
  }

  protected source() {
    return new AppleActivitySource({
      biome: biomeDirectory(this.host.home),
      knowledge: knowledgeStorePath(this.host.home),
    });
  }
}
