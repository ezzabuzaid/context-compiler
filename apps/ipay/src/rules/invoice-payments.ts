import { createHash } from 'node:crypto';

import {
  APICallError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
  generateText,
} from 'ai';
import { convert } from 'html-to-text';
import { z } from 'zod';

import { type LoadedRow, Rule, type RuleResult } from '@workspace/elt';
import { ground } from '@workspace/quote-grounding';

import model from './payment-model.ts';

type Email = { readonly id: string; readonly text: string };

// The categories of ipay's first version, and other for a payment none fits.
const categories = [
  'food',
  'utilities',
  'entertainment',
  'transportation',
  'education',
  'healthcare',
  'shopping',
  'cloud_services',
  'other',
] as const;

const paymentsSchema = z.object({
  payments: z.array(
    z.object({
      quote: z.string(),
      company: z.string(),
      service: z.string(),
      category: z.enum(categories),
      amount: z.number(),
      currency: z.string(),
      frequency: z.enum(['once', 'monthly', 'annually']),
    }),
  ),
});

const system = `You read one email the user received. List only the payments that the user made and that the email confirms: a receipt, a paid invoice, a charge to the user's card or account, a renewal that was charged. For each payment, first copy the one line of the email that states its amount, word for word, as quote. Then read from the email: amount, a number without currency symbols or thousands separators; currency, its ISO 4217 code, such as USD or JOD; company, the company that charged the user, such as Spotify, Google or AWS; service, the product or plan the payment is for, such as Google One 100 GB or Spotify Premium, never what was bought with it and never its frequency; category, one of ${categories.join(', ')}; frequency, monthly or annually for a subscription that renews so, else once. An email that only advertises, quotes a price, says that a payment is due or upcoming, failed or was refunded confirms no payment: return an empty list. A revised or corrected invoice is the payment of the invoice it revises, listed once. An email that charges for several services lists each.`;

// The whole email: the longest candidate on this Mac, a Careem receipt of
// about 130,000 characters of HTML, is far smaller as text and far inside
// GPT-6-Luna's context of 272,000 tokens.
const settings = { maxOutputTokens: 16_000 } as const;

// The model and everything that it reads besides the email, so a changed
// prompt, schema or setting makes every output again.
const identity = `${model.modelId}:${createHash('sha256')
  .update(
    JSON.stringify({
      system,
      schema: z.toJSONSchema(paymentsSchema),
      settings,
    }),
  )
  .digest('hex')}`;

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

// The email as one text: its sender and subject, its body, and the text of
// each attachment, such as a PDF invoice.
function emailText(row: LoadedRow): string {
  const { sender, subject, attachment_text } = row;
  return [
    `From: ${typeof sender === 'string' ? sender : ''}`,
    `Subject: ${typeof subject === 'string' ? subject : ''}`,
    '',
    bodyText(row),
    ...strings(attachment_text).map((text) => `\nAttachment:\n${text}`),
  ].join('\n');
}

// The payments that each candidate email confirms, as GPT-6-Luna reads them.
// A payment stays only when its quote is in the email, so an invented amount
// is never a payment.
export class InvoicePayments extends Rule<Email, string> {
  override readonly key = {
    name: 'id',
    description:
      "Mail's local identifier of the email that states the payments.",
  };
  override readonly output = {
    payments: {
      type: 'text',
      description:
        'A JSON array of the payments that the email confirms, each with its company, service, category, amount, currency, frequency, its quote and the span of the quote in the email text. NULL unless status is computed.',
    },
  } as const;
  // One email for each model call. Four calls at once stay inside the rate
  // limits of a ChatGPT subscription, as startup-credits' offers do.
  override readonly batch = 1;
  override readonly concurrency = 4;

  override read(
    row: LoadedRow,
  ): { readonly key: string; readonly input: Email } | null {
    return typeof row.id === 'string'
      ? { key: row.id, input: { id: row.id, text: emailText(row) } }
      : null;
  }

  override async identity(): Promise<string> {
    return identity;
  }

  override async compute(
    emails: readonly Email[],
    signal?: AbortSignal,
  ): Promise<readonly RuleResult<Readonly<Record<string, string>>>[]> {
    return Promise.all(emails.map((email) => this.#payments(email, signal)));
  }

  async #payments(
    email: Email,
    signal: AbortSignal | undefined,
  ): Promise<RuleResult<Readonly<Record<string, string>>>> {
    let payments;
    try {
      ({
        output: { payments },
      } = await generateText({
        model,
        instructions: system,
        prompt: email.text,
        output: Output.object({ schema: paymentsSchema }),
        ...settings,
        abortSignal: signal,
      }));
    } catch (error) {
      // An answer with no payments in it, such as a refusal or an answer cut
      // at maxOutputTokens, and a call that failed after the AI SDK's
      // retries, are this email's failure. A rejected token is not: every
      // email would fail, so the dataset fails. A stop is no failure.
      if (
        NoObjectGeneratedError.isInstance(error) ||
        NoOutputGeneratedError.isInstance(error)
      )
        return { error: error.message };
      // A RetryError holds the failure of each call; the last one is why.
      const call = RetryError.isInstance(error) ? error.lastError : error;
      if (APICallError.isInstance(call) && call.statusCode !== 401)
        return { error: call.message };
      throw error;
    }
    const kept = payments.flatMap((payment) => {
      const span = ground(email.text, payment.quote);
      return span === null ? [] : [{ ...payment, span }];
    });
    return kept.length === 0
      ? { empty: true }
      : { value: { payments: JSON.stringify(kept) } };
  }
}
