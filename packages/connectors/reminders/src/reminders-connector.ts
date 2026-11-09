import { RemindersStore } from '@eltjs/sdk-apple-eventkit';
import type { ImportScope } from '@eltjs/source-apple-macos/import-scope';
import { AppleRemindersSource } from '@eltjs/source-apple-reminders/apple-reminders-source';
import {
  type Choice,
  accounts,
  collections,
  name,
} from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

export default class RemindersConnector extends Connector {
  readonly datedBy = null;
  readonly fullDiskAccess = false;
  protected readonly choices: readonly Choice[] = [
    accounts(name),
    collections('lists', 'lists'),
  ];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(grantee: string): string {
    return `Allow ${grantee} full Reminders access when macOS asks, or in System Settings › Privacy & Security › Reminders.`;
  }

  protected sources(scope: ImportScope) {
    return [
      new AppleRemindersSource({
        store: new RemindersStore(this.host.eventKitHelper, {
          env: this.host.env,
        }),
        scope,
      }),
    ] as const;
  }
}
