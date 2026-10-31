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

import { ground, same } from './ground.ts';
import model from './offer-model.ts';
import {
  type StoredOffer,
  offerIdentity,
  offerValue,
  offersSchema,
} from './offer.ts';

type Page = {
  readonly url: string;
  readonly title: string | null;
  readonly text: string;
};

const system =
  'You read one web page of a startup program. List only the offers that the page states, each offer once. For each offer, first copy the one sentence of the page text that states it, word for word, as quote; never quote the URL or the title. Then read kind, value and the rest from that sentence. kind: credits (credits, a commitment amount or a balance to spend on the product), discount (a percentage or reduced price), free_period (free use of a paid plan for a fixed time), support (technical help, mentorship), perks (deals from other companies). value: the amount and its ISO 4217 currency code when the sentence states one, else null; read $100K as 100000. months: the length of a free period in months when the sentence states one, else null; a year is 12. If the page states no offer, return an empty list. Each tier of a program is its own offer. A part or a first step of one offer is not a separate offer: for "up to $5,000" and "Start with $1,000", state only the $5,000 offer.';

// The whole page: the longest stored page, about 83,000 characters, is far
// inside Haiku's context.
const prompt = ({ url, title, text }: Page) =>
  `URL: ${url}\n${title === null ? '' : `Title: ${title}\n`}\n${text}`;

// Thinking counts toward maxOutputTokens, so the limit leaves room for it
// and for the answer of a long page.
const settings = {
  maxOutputTokens: 16_000,
  providerOptions: { anthropic: { effort: 'medium' } },
} as const;

// The model and everything that the model reads besides the page, so a
// changed prompt, schema or setting makes every output again.
const identity = `${model.modelId}:${createHash('sha256')
  .update(
    JSON.stringify({
      system,
      prompt: prompt({ url: '{url}', title: '{title}', text: '{text}' }),
      schema: z.toJSONSchema(offersSchema),
      settings,
    }),
  )
  .digest('hex')}`;

// Whether a second offer repeats one that the page already has: the same
// kind and value, and, for an offer that states no value, such as support,
// also the same sentence. Two support offers of a page can be different
// offers.
const repeats = (offer: StoredOffer, kept: StoredOffer) =>
  offerIdentity(offer) === offerIdentity(kept) &&
  (offerValue(offer) !== null || same(offer.span, kept.span));

// The offers that each stored program page states, as Claude Haiku 5.5 reads
// them. An offer stays only when its quote is in the page text, so an
// invented quote or an echo of the prompt is never an offer.
export class ProgramOffers extends Rule<Page, string> {
  override readonly key = {
    name: 'articleUrl',
    description: 'The article URL of the page that states the offers.',
  };
  override readonly output = {
    offers: {
      type: 'text',
      description:
        'A JSON array of the offers that the page states, each with its kind, its value, its quote and the span of the quote in the page text. NULL unless status is computed.',
    },
  } as const;
  // One page for each model call. Four calls at once stay inside the rate
  // limits of a Claude subscription.
  override readonly batch = 1;
  override readonly concurrency = 4;

  override read(
    row: LoadedRow,
  ): { readonly key: string; readonly input: Page } | null {
    const { articleUrl, title, textContent } = row;
    return typeof articleUrl === 'string' &&
      (typeof title === 'string' || title === null) &&
      typeof textContent === 'string'
      ? {
          key: articleUrl,
          input: { url: articleUrl, title, text: textContent },
        }
      : null;
  }

  override async identity(): Promise<string> {
    return identity;
  }

  override async compute(
    pages: readonly Page[],
    signal?: AbortSignal,
  ): Promise<readonly RuleResult<Readonly<Record<string, string>>>[]> {
    return Promise.all(pages.map((page) => this.#offers(page, signal)));
  }

  async #offers(
    page: Page,
    signal: AbortSignal | undefined,
  ): Promise<RuleResult<Readonly<Record<string, string>>>> {
    let offers;
    try {
      ({
        output: { offers },
      } = await generateText({
        model,
        system,
        prompt: prompt(page),
        output: Output.object({ schema: offersSchema }),
        ...settings,
        abortSignal: signal,
      }));
    } catch (error) {
      // An answer with no offers in it, such as a refusal or an answer cut
      // at maxOutputTokens, and a call that failed after the AI SDK's
      // retries, are this page's failure. A rejected token is not: every
      // page would fail, so the dataset fails. A stop is no failure.
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
    const kept: StoredOffer[] = [];
    for (const offer of offers) {
      const span = ground(page.text, offer.quote);
      if (span === null) continue;
      const stored = { ...offer, span };
      if (!kept.some((other) => repeats(stored, other))) kept.push(stored);
    }
    return kept.length === 0
      ? { empty: true }
      : { value: { offers: JSON.stringify(kept) } };
  }
}
