import type { RecordDraft } from '@workspace/elt';

import { bankSenders } from '../../rules/arab-bank-sms.ts';
import { type ImportRow, ImportStream } from '../import-stream.ts';
import type { ImportsScan } from '../imports-scan.ts';

const properties = {
  guid: {
    type: 'string',
    minLength: 1,
    description:
      "The message's GUID in the Messages import (messages.guid); the primary key.",
  },
  date: {
    type: ['string', 'null'],
    format: 'date-time',
    description: 'When the message was sent, as a UTC timestamp.',
  },
  handle: {
    type: 'string',
    description: 'The sender as Messages names it, such as Arab Bank.',
  },
  text: { type: ['string', 'null'], description: 'The text of the message.' },
} as const;

export class BankMessagesStream extends ImportStream<typeof properties> {
  readonly name = 'bank_messages';
  readonly connector = 'messages';
  readonly reads = ['messages'];
  readonly primaryKey = ['guid'];
  readonly jsonSchema = {
    type: 'object',
    description:
      "The texts the user's bank sent, which bank_charges reads for each debit and credit. Primary key guid.",
    properties,
    required: Object.keys(properties),
  } as const;

  protected rows(scan: ImportsScan): Iterable<ImportRow> {
    return scan
      .snapshot('messages')
      .iterate(
        `SELECT guid, date, handle, text FROM messages WHERE NOT isFromMe AND handle IN (${bankSenders.map(() => '?').join(', ')})`,
        ...bankSenders,
      );
  }

  protected record({
    guid,
    date,
    handle,
    text,
  }: ImportRow): RecordDraft<typeof properties> {
    return { guid, date, handle, text };
  }
}
