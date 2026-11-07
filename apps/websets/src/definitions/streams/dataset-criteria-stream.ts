import type { RecordDraft } from '@workspace/elt';

import type { Asked } from '../definitions-scan.ts';
import { DefinitionsStream } from '../definitions-stream.ts';

const properties = {
  dataset: {
    type: 'string',
    minLength: 1,
    description: 'The id of the dataset.',
  },
  position: {
    type: 'integer',
    minimum: 0,
    description: 'The position of the criterion in the dataset, from 0.',
  },
  criterion: {
    type: 'string',
    minLength: 1,
    description: 'What the criterion asks of a page, in words a model reads.',
  },
} as const;

export class DatasetCriteriaStream extends DefinitionsStream<
  typeof properties
> {
  readonly name = 'dataset_criteria';
  readonly primaryKey = ['dataset', 'position'];
  readonly jsonSchema = {
    type: 'object',
    description:
      'The criteria of each dataset, in order. Primary key dataset and position.',
    properties,
    required: Object.keys(properties),
  } as const;

  protected records({ id, criteria }: Asked): RecordDraft<typeof properties>[] {
    return criteria.map(({ description }, position) => ({
      dataset: id,
      position,
      criterion: description,
    }));
  }
}
