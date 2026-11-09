import { noteStorePath } from '@eltjs/sdk-apple-notes';
import type { ImportScope } from '@eltjs/source-apple-macos/import-scope';
import { AppleNotesSource } from '@eltjs/source-apple-notes/apple-notes-source';
import {
  type Choice,
  accounts,
  collections,
  name,
} from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

export default class NotesConnector extends Connector {
  readonly datedBy = 'date last edited';
  readonly fullDiskAccess = true;
  override readonly note =
    'Exact containing folders; select descendants separately. Smart folders are saved searches and cannot be selected as containing folders.';
  protected readonly choices: readonly Choice[] = [
    accounts(name),
    collections('folders', 'folders'),
  ];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(): string {
    return 'Open Notes to let it finish syncing iCloud changes.';
  }

  protected sources(scope: ImportScope) {
    return [
      new AppleNotesSource({
        path: noteStorePath(this.host.home),
        scope,
      }),
    ] as const;
  }
}
