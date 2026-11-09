import { accountsStorePath } from '@eltjs/sdk-apple-accounts';
import { AppleAccountsSource } from '@eltjs/source-apple-accounts/apple-accounts-source';
import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

export default class AccountsConnector extends Connector {
  readonly datedBy = null;
  readonly fullDiskAccess = true;
  // One small store of every account on this Mac; everything is imported.
  protected readonly choices: readonly Choice[] = [];
  // Reading the accounts opens the protected Accounts store.
  protected override readonly probe = 'accounts';
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(): string {
    return 'No app needs to be open: macOS keeps every account its apps sync through in one store.';
  }

  protected sources() {
    return [
      new AppleAccountsSource({
        path: accountsStorePath(this.host.home),
      }),
    ] as const;
  }
}
