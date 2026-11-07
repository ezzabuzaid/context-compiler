import type { RecordDraft } from '@workspace/elt';

import type { Asked } from '../definitions-scan.ts';
import { DefinitionsStream } from '../definitions-stream.ts';

const properties = {
  dataset: {
    type: 'string',
    minLength: 1,
    description: 'The id of the dataset.',
  },
  inputUrl: {
    type: 'string',
    minLength: 1,
    description:
      'A starting URL of the dataset: a page that it gives, a page that its search found, or a list.',
  },
} as const;

export class DatasetInputsStream extends DefinitionsStream<typeof properties> {
  readonly name = 'dataset_inputs';
  readonly primaryKey = ['dataset', 'inputUrl'];
  readonly jsonSchema = {
    type: 'object',
    description:
      'The starting URLs of each dataset, each once. Primary key dataset and inputUrl.',
    properties,
    required: Object.keys(properties),
  } as const;

  protected records({
    id,
    pages,
    seeds,
    lists,
  }: Asked): RecordDraft<typeof properties>[] {
    return [...new Set([...pages, ...seeds, ...lists])].map((inputUrl) => ({
      dataset: id,
      inputUrl,
    }));
  }
}
