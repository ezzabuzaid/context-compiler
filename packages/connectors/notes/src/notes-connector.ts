import {
  type Choice,
  accounts,
  collections,
  name,
} from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';
import type { ImportScope } from '@workspace/source-apple-macos/import-scope';
import { AppleNotesSource } from '@workspace/source-apple-notes/apple-notes-source';

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

  protected source(scope: ImportScope) {
    return new AppleNotesSource({ scope });
  }
}
