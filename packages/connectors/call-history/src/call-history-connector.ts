import { callHistoryStorePath } from '@eltjs/sdk-apple-call-history';
import { AppleCallHistorySource } from '@eltjs/source-apple-call-history/apple-call-history-source';
import type { ImportScope } from '@eltjs/source-apple-macos/import-scope';
import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

export default class CallHistoryConnector extends Connector {
  readonly datedBy = 'call date';
  readonly fullDiskAccess = true;
  // One small store of every call on this Mac; a date range is the only
  // narrowing.
  protected readonly choices: readonly Choice[] = [];
  // Reading the calls opens the protected call history store.
  protected override readonly probe = 'calls';
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(): string {
    return 'No app needs to be open: macOS keeps the calls from Phone, FaceTime and your iPhone in one store.';
  }

  protected sources(scope: ImportScope) {
    return [
      new AppleCallHistorySource({
        path: callHistoryStorePath(this.host.home),
        scope,
      }),
    ] as const;
  }
}
