import { chatDatabasePath } from '@eltjs/sdk-apple-messages';
import type { ImportScope } from '@eltjs/source-apple-macos/import-scope';
import { AppleMessagesSource } from '@eltjs/source-apple-messages/apple-messages-source';
import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

export default class MessagesConnector extends Connector {
  readonly datedBy = 'message date';
  protected readonly choices: readonly Choice[] = [
    {
      stream: 'chats',
      scope: 'collectionIds',
      title: 'chats',
      id: (row) => String(row.guid),
      label: (row) => String(row.displayName || row.chatIdentifier),
    },
  ];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected sources(scope: ImportScope) {
    return [
      new AppleMessagesSource({
        path: chatDatabasePath(this.host.home),
        home: this.host.home,
        scope,
      }),
    ] as const;
  }
}
