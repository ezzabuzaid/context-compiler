import { biomeDirectory } from '@eltjs/sdk-apple-biome';
import { knowledgeStorePath } from '@eltjs/sdk-apple-knowledge';
import { AppleActivitySource } from '@eltjs/source-apple-activity/apple-activity-source';
import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

export default class ActivityConnector extends Connector {
  readonly datedBy = null;
  // macOS keeps a few weeks of activity; everything it keeps is imported.
  protected readonly choices: readonly Choice[] = [];
  // A small Biome stream: reading it lists the protected Biome folder.
  protected override readonly probe = 'appMenuItems';
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected sources() {
    return [
      new AppleActivitySource({
        biome: biomeDirectory(this.host.home),
        knowledge: knowledgeStorePath(this.host.home),
      }),
    ] as const;
  }
}
