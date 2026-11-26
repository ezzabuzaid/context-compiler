import type { SQLiteDestination } from '@eltjs/elt-sqlite';
import { AccountsStore, accountsStorePath } from '@eltjs/sdk-apple-accounts';
import { MailChangingError, mailDirectory } from '@eltjs/sdk-apple-mail';
import type { ImportScope } from '@eltjs/source-apple-macos/import-scope';
import {
  AppleMailSource,
  restrictedMailStreams,
} from '@eltjs/source-apple-mail/apple-mail-source';
import {
  type Choice,
  type Row,
  accounts,
  byId,
} from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

import { mailContentStatus } from './mail-content-status.ts';

const accountName = (row: Row) =>
  String(JSON.parse(String(row.properties)).name);

export default class MailConnector extends Connector {
  readonly datedBy = 'date received (date sent if missing)';
  protected readonly choices: readonly Choice[] = [
    { ...accounts(accountName), id: (row) => String(row.identifier) },
    {
      stream: 'mailboxes',
      scope: 'collectionIds',
      title: 'mailboxes',
      id: byId,
      // A mailbox URL names its account as the host.
      label: (row, rows) => {
        const url = new URL(String(row.url));
        const account = rows
          .get('accounts')
          ?.find(({ identifier }) => identifier === url.hostname);
        const path = decodeURIComponent(url.pathname.slice(1));
        return account === undefined
          ? path
          : `${accountName(account)} / ${path}`;
      },
    },
  ];
  protected readonly unscoped = restrictedMailStreams;
  // Each message's raw .emlx; messageParts already holds its decoded text.
  protected readonly storeCopies = ['messageFiles'];

  protected override derived(destination: SQLiteDestination) {
    return [mailContentStatus(destination)];
  }

  protected override retryImport(error: unknown): boolean {
    return error instanceof MailChangingError;
  }

  protected sources(scope: ImportScope) {
    return [
      new AppleMailSource({
        path: mailDirectory(this.host.home),
        accounts: new AccountsStore(accountsStorePath(this.host.home)),
        scope,
      }),
    ] as const;
  }
}
