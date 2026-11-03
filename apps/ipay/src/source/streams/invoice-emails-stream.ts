import type { RecordDraft } from '@workspace/elt';

import { type ImportRow, ImportStream } from '../import-stream.ts';
import type { ImportsScan } from '../imports-scan.ts';

const text = { type: ['string', 'null'] } as const;

const properties = {
  id: {
    type: 'string',
    minLength: 1,
    description:
      "Mail's local message identifier in the Mail import (mail_messages.id); the primary key.",
  },
  conversation_id: {
    ...text,
    description:
      "Mail's conversation identifier; messages of one thread share it.",
  },
  received_at: {
    type: ['string', 'null'],
    format: 'date-time',
    description: 'When Mail received the message, as a UTC timestamp.',
  },
  sender: { ...text, description: "The sender's email address." },
  sender_name: { ...text, description: "The sender's display name." },
  subject: {
    ...text,
    description:
      'The subject as Mail shows it, with its reply or forward prefix.',
  },
  body_text: {
    ...text,
    description: 'The text/plain parts of the message, joined in part order.',
  },
  body_html: {
    ...text,
    description:
      'The text/html parts of the message, joined in part order, as raw HTML.',
  },
  attachment_text: {
    type: 'array',
    items: { type: 'string' },
    description:
      "The text Context Compiler read from each of the message's attachments, such as a PDF invoice; empty when it read none or the import copies no attachments.",
  },
} as const;

// Words of a subject that a receipt, an invoice or a charge is sent under,
// in English and Arabic: the candidates the invoice rule reads.
const subjectTerms = [
  'receipt',
  'invoice',
  'payment',
  'your order',
  'order confirm',
  'your delivery from',
  'subscription',
  'renew',
  'billing',
  'charged',
  'purchase',
  'فاتور',
  'إيصال',
  'دفع',
  'اشتراك',
];
// A body that names an invoice or a fare together with a sum, as ipay's
// first version found invoices sent under other subjects.
const bodyNames = ['invoice', ' fare'];
const bodySums = ['total', 'charged', 'amount', 'receipt', 'paid'];

const any = (column: string, terms: readonly string[]) =>
  `(${terms.map(() => `${column} LIKE ?`).join(' OR ')})`;
const patterns = (terms: readonly string[]) => terms.map((term) => `%${term}%`);

export class InvoiceEmailsStream extends ImportStream<typeof properties> {
  readonly name = 'invoice_emails';
  readonly connector = 'mail';
  readonly reads = ['messages', 'messageParts', 'attachments'];
  readonly primaryKey = ['id'];
  readonly jsonSchema = {
    type: 'object',
    description:
      'The Mail messages that may state a payment: a subject with a receipt, invoice, payment, order or subscription term, or a body that names an invoice or a fare with a sum. Candidates, not payments: invoice_payments says which state one. Primary key id.',
    properties,
    required: Object.keys(properties),
  } as const;

  protected *rows(scan: ImportsScan): Iterable<ImportRow> {
    const mail = scan.snapshot('mail');
    // An import that copies no attachments has no text of them.
    const attachmentText =
      mail.all("SELECT 1 FROM sqlite_schema WHERE name = 'attachment_text'")
        .length === 0
        ? "json('[]')"
        : "(SELECT json_group_array(t.content) FROM attachments a JOIN attachment_text t ON t.ref = a.attachmentRef WHERE a.messageId = m.id AND t.status = 'computed')";
    const subject = "lower(coalesce(m.subject, ''))";
    const body =
      "lower(coalesce(m.body_text, '') || char(10) || coalesce(m.body_html, ''))";
    yield* mail.iterate(
      `SELECT m.id, m.conversation_id, m.received_at, m.sender, m.sender_name, m.subject, m.body_text, m.body_html, ${attachmentText} AS attachment_text
        FROM mail_messages m
        WHERE ${any(subject, subjectTerms)} OR (${any(body, bodyNames)} AND ${any(body, bodySums)})`,
      ...patterns(subjectTerms),
      ...patterns(bodyNames),
      ...patterns(bodySums),
    );
  }

  protected record({
    id,
    conversation_id,
    received_at,
    sender,
    sender_name,
    subject,
    body_text,
    body_html,
    attachment_text,
  }: ImportRow): RecordDraft<typeof properties> {
    return {
      id,
      conversation_id,
      received_at,
      sender,
      sender_name,
      subject,
      body_text,
      body_html,
      attachment_text: JSON.parse(String(attachment_text)),
    };
  }
}
