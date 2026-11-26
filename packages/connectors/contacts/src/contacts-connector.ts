import {
  addressBookDirectory,
  globalPreferences,
} from '@eltjs/sdk-apple-contacts';
import { AppleContactsSource } from '@eltjs/source-apple-contacts/apple-contacts-source';
import type { ImportScope } from '@eltjs/source-apple-macos/import-scope';
import { type Choice, name } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

export default class ContactsConnector extends Connector {
  readonly datedBy = null;
  protected readonly choices: readonly Choice[] = [
    {
      stream: 'containers',
      scope: 'collectionIds',
      title: 'accounts',
      // The source narrows to containers by their uniqueId; id is a Z_PK.
      id: (row) => String(row.uniqueId),
      label: name,
    },
  ];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected sources(scope: ImportScope) {
    return [
      new AppleContactsSource({
        directory: addressBookDirectory(this.host.home),
        preferences: globalPreferences(this.host.home),
        scope,
      }),
    ] as const;
  }
}
