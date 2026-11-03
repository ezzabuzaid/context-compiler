import { convert } from 'html-to-text';

import type { LoadedRow } from '@workspace/elt';

const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? JSON.parse(value).filter((each: unknown) => typeof each === 'string')
    : [];

// The email's plain text, or its HTML as text when it has none.
function bodyText(row: LoadedRow): string {
  const { body_text, body_html } = row;
  if (typeof body_text === 'string') return body_text;
  if (typeof body_html !== 'string') return '';
  return convert(body_html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      // Receipts lay out their items and totals in tables: a row is
      // a line, with its cells apart, as a reader sees it.
      { selector: 'table', format: 'dataTable' },
    ],
  });
}

// The email as one text, as each model reads it: its sender and subject, its
// body, and the text of each attachment, such as a PDF invoice.
export function emailText(row: LoadedRow): string {
  const { sender, subject, attachment_text } = row;
  return [
    `From: ${typeof sender === 'string' ? sender : ''}`,
    `Subject: ${typeof subject === 'string' ? subject : ''}`,
    '',
    bodyText(row),
    ...strings(attachment_text).map((text) => `\nAttachment:\n${text}`),
  ].join('\n');
}
