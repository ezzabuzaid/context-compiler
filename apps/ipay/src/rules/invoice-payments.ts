import { createHash } from 'node:crypto';

import {
  APICallError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
  generateText,
} from 'ai';
import { z } from 'zod';

import { type LoadedRow, Rule, type RuleResult } from '@workspace/elt';
import { ground } from '@workspace/quote-grounding';

import { emailText } from './email-text.ts';
import model from './payment-model.ts';

type Email = { readonly id: string; readonly text: string };

const paymentsSchema = z.object({
  payments: z.array(
    z.object({
      quote: z.string(),
      company: z.string(),
      service: z.string(),
      amount: z.number(),
      currency: z.string(),
    }),
  ),
});

const system = `You read one email the user received. List the payments that the user made and that the email confirms: a receipt, a paid invoice, a charge to the user's card or account, a renewal that was charged. For each payment, first copy the one line of the email that states its amount, word for word, as quote. Then read from the email: amount, a number without currency symbols or thousands separators; currency, its ISO 4217 code, such as USD or JOD; company, the company that charged the user, such as Spotify, Google or AWS; service, the product or plan the payment is for, such as Google One 100 GB or Spotify Premium, never what was bought with it and never its frequency. When the email confirms no payment, return an empty list. A revised or corrected invoice is the payment of the invoice it revises, listed once. An email that charges for several services lists each.`;

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

// The payments that each email Jev decided payment confirms, as GPT-6-Luna
// reads them. A payment stays only when its quote is in the email, so an
// invented amount is never a payment.
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
        'A JSON array of the payments that the email confirms, each with its company, service, amount, currency, its quote and the span of the quote in the email text. NULL unless status is computed.',
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
