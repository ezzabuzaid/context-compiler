import {
  type FinishReason,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  generateText,
} from 'ai';
import { z } from 'zod';

import { type LoadedRow, Rule, type RuleResult } from '@workspace/elt';
import { CallFailures } from '@workspace/model-calls/call-failures';
import { ruleIdentity } from '@workspace/model-calls/rule-identity';
import { ground } from '@workspace/quote-grounding';

import {
  type Offer,
  type StoredOffer,
  offerIdentity,
  offerValue,
  offersSchema,
} from '../offer.ts';
import { same } from '../same.ts';
import model from './offer-model.ts';

export type Page = {
  readonly url: string;
  readonly title: string | null;
  readonly text: string;
};

// The model answered, but not with a list of offers that agrees with the
// schema. text is the answer when the AI SDK kept it.
export type InvalidAnswer = {
  readonly message: string;
  readonly text: string | undefined;
  readonly finishReason: FinishReason | undefined;
};

export type OffersOutcome =
  | { readonly offers: readonly StoredOffer[] }
  | { readonly invalid: InvalidAnswer }
  | { readonly failed: string };

const system =
  'You read one web page of a startup program. List only the offers that the page states, each offer once. For each offer, first copy the one sentence of the page text that states it, word for word, as quote; never quote the URL or the title. Then read kind, value and the rest from that sentence. kind: credits (credits, a commitment amount or a balance to spend on the product), discount (a percentage or reduced price), free_period (free use of a paid plan for a fixed time), support (technical help, mentorship, training and learning resources, events and a founder community, introductions to investors, co-marketing), perks (deals from other companies). value: the amount and its ISO 4217 currency code when the sentence states one, else null; read $100K as 100000. months: the length of a free period in months when the sentence states one, else null; a year is 12. If the page states no offer, return an empty list. Each tier of a program is its own offer. A part or a first step of one offer is not a separate offer: for "up to $5,000" and "Start with $1,000", state only the $5,000 offer.';

// The whole page: the longest stored page, about 83,000 characters, is far
// inside GPT-6-Luna's context of 272,000 tokens.
const prompt = ({ url, title, text }: Page) =>
  `URL: ${url}\n${title === null ? '' : `Title: ${title}\n`}\n${text}`;

// Thinking counts toward maxOutputTokens, so the limit leaves room for it
// and for the answer of a long page.
const settings = { maxOutputTokens: 16_000 } as const;

// The model and everything that the model reads besides the page, so a
// changed prompt, schema or setting makes every output again.
const identity = ruleIdentity(model.modelId, {
  system,
  prompt: prompt({ url: '{url}', title: '{title}', text: '{text}' }),
  schema: z.toJSONSchema(offersSchema),
  settings,
});

// The answer errors of generateText are an invalid answer, apart from a
// failed call, so this rule reads them before it asks failures.
const failures = new CallFailures();

// Whether a second offer repeats one that the page already has: the same
// kind and value, and, for an offer that states no value, such as support,
// also the same sentence. Two support offers of a page can be different
// offers.
const repeats = (offer: StoredOffer, kept: StoredOffer) =>
  offerIdentity(offer) === offerIdentity(kept) &&
  (offerValue(offer) !== null || same(offer.span, kept.span));

// A discount of 0% is the percent of a waived fee, as in "0% processing fees
// for 12 months": the offer is the waiver, which takes no percent off a
// price.
const waived = (offer: Offer): Offer =>
  offer.kind === 'discount' && offer.percent === 0
    ? { ...offer, percent: null }
    : offer;

// The offers that each stored program page states, as GPT-6-Luna reads
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
    return Promise.all(
      pages.map(async (page) => {
        const outcome = await this.outcome(page, signal);
        if ('failed' in outcome) return { error: outcome.failed };
        if ('invalid' in outcome) return { error: outcome.invalid.message };
        return outcome.offers.length === 0
          ? { empty: true }
          : { value: { offers: JSON.stringify(outcome.offers) } };
      }),
    );
  }

  // What the model gave for one page: the offers whose quotes are in the
  // page text, an answer that is not a list of offers (a refusal, an answer
  // cut at maxOutputTokens, or text that does not agree with the schema), or
  // a call that failed after the AI SDK's retries. compute() stores the last
  // two as the page's failure; an eval scores an invalid answer apart from a
  // failed call (#3762). A rejected token throws: every page would fail, so
  // the dataset fails. A stop throws too: it is no failure.
  async outcome(
    page: Page,
    signal: AbortSignal | undefined,
  ): Promise<OffersOutcome> {
    let answered;
    try {
      // The output, not only the call, is in the try: an answer that ends
      // with no text, such as one cut at maxOutputTokens before any text,
      // throws NoOutputGeneratedError when its output is read.
      answered = (
        await generateText({
          model,
          instructions: system,
          prompt: prompt(page),
          output: Output.object({ schema: offersSchema }),
          ...settings,
          abortSignal: signal,
        })
      ).output;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error))
        return {
          invalid: {
            message: error.message,
            text: error.text,
            finishReason: error.finishReason,
          },
        };
      if (NoOutputGeneratedError.isInstance(error))
        return {
          invalid: {
            message: error.message,
            text: undefined,
            finishReason: undefined,
          },
        };
      return { failed: failures.reason(error) };
    }
    const kept: StoredOffer[] = [];
    for (const offer of answered.offers) {
      const span = ground(page.text, offer.quote);
      if (span === null) continue;
      const stored = { ...waived(offer), span };
      if (!kept.some((other) => repeats(stored, other))) kept.push(stored);
    }
    return { offers: kept };
  }
}
