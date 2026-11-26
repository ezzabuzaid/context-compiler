import type { Source } from '@eltjs/elt';
import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

// A second connector named notes.
export default class NotesAgainConnector extends Connector {
  readonly datedBy = 'date taken';
  protected readonly choices: readonly Choice[] = [];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected sources(): readonly [Source] {
    throw new Error('The Photos fixture reads nothing.');
  }
}
