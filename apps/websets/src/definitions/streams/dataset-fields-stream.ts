import type { RecordDraft } from '@workspace/elt';

import type { Asked } from '../definitions-scan.ts';
import { DefinitionsStream } from '../definitions-stream.ts';

const properties = {
  dataset: {
    type: 'string',
    minLength: 1,
    description: 'The id of the dataset.',
  },
  name: {
    type: 'string',
    minLength: 1,
    description: 'The name of the field in the dataset.',
  },
  description: {
    type: 'string',
    minLength: 1,
    description: 'What the field is, in words a model reads.',
  },
  format: {
    type: 'string',
    enum: ['text', 'number', 'date', 'url', 'options'],
    description: 'The format of the value.',
  },
  options: {
    type: ['string', 'null'],
    description:
      'The options of an options field, as a JSON array of strings; NULL for any other format.',
  },
} as const;

export class DatasetFieldsStream extends DefinitionsStream<typeof properties> {
  readonly name = 'dataset_fields';
  readonly primaryKey = ['dataset', 'name'];
  readonly jsonSchema = {
    type: 'object',
    description:
      'The fields that each dataset extracts from its items. Primary key dataset and name.',
    properties,
    required: Object.keys(properties),
  } as const;

  protected records({ id, fields }: Asked): RecordDraft<typeof properties>[] {
    return fields.map((field) => ({
      dataset: id,
      name: field.name,
      description: field.description,
      format: field.format,
      options:
        field.format === 'options' ? JSON.stringify(field.options) : null,
    }));
  }
}
