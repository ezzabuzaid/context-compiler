import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';
import type { Source } from '@workspace/elt';

// A second connector named notes.
export default class NotesAgainConnector extends Connector {
  readonly datedBy = 'date taken';
  readonly fullDiskAccess = true;
  protected readonly choices: readonly Choice[] = [];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(): string {
    return 'Open Photos once.';
  }

  protected source(): Source {
    throw new Error('The Photos fixture reads nothing.');
  }
}
