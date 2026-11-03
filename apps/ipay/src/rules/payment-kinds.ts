import { createHash } from 'node:crypto';

import {
  APICallError,
  Experimental_DecisionRefusalError,
  InvalidResponseDataError,
  LoadAPIKeyError,
  RetryError,
  experimental_decide as decide,
} from 'ai';

import { type LoadedRow, Rule, type RuleResult } from '@workspace/elt';

import { openRouterDecisionModel } from './decision-model.ts';
import { emailText } from './email-text.ts';

// The questions that screen each candidate email, each with one criterion
// for each of its choices. Only an email whose kind is payment goes on to
// GPT-6-Luna; its category and frequency label each of its payments.
const paymentQuestions = {
  kind: {
    type: 'choice',
    instructions: "What does this email say about the user's money?",
    criteria: {
      payment:
        'a payment the user made that the email confirms: a receipt, a paid invoice, a charge to a card or account, a renewal that was charged',
      upcoming: 'a payment that is due or upcoming, or a trial that is ending',
      failed: 'a payment that failed or was declined',
      refund: 'a refund or a reversal',
      offer: 'advertising, a newsletter or a price quote',
      other: 'anything else',
    },
  },
  // The categories of ipay's first version, and other for a payment none
  // fits.
  category: {
    type: 'choice',
    instructions: 'What is the money for?',
    criteria: {
      food: 'food, groceries, restaurants and food delivery',
      utilities:
        'electricity, water, internet, phone and other household bills',
      entertainment: 'music, video, games and other entertainment',
      transportation: 'rides, fuel, parking, flights and other travel',
      education: 'courses, books and tuition',
      healthcare: 'doctors, medicine and health insurance',
      shopping: 'goods bought online or in a store',
      cloud_services: 'software, apps, cloud services and hosting',
      other: 'anything else',
    },
  },
  frequency: {
    type: 'choice',
    instructions: 'How often is the user charged for it?',
    criteria: {
      once: 'once',
      monthly: 'every month',
      annually: 'every year',
    },
  },
} as const;

const choices = (question: keyof typeof paymentQuestions) =>
  Object.keys(paymentQuestions[question].criteria).join(', ');

const modelId = 'typesafe/jev-1.14';

// What each candidate email says about the user's money, as Jev decides it:
// ipay reads payments only from the emails decided payment.
export class PaymentKinds extends Rule<string, string> {
  readonly #model = openRouterDecisionModel(modelId);

  override readonly key = {
    name: 'id',
    description: "Mail's local identifier of the decided email.",
  };
  override readonly output = {
    kind: {
      type: 'text',
      description: `What the email says about the user's money: ${choices('kind')}. NULL unless status is computed.`,
    },
    category: {
      type: 'text',
      description: `What the money is for: ${choices('category')}. NULL unless status is computed.`,
    },
    frequency: {
      type: 'text',
      description: `How often the user is charged: ${choices('frequency')}. NULL unless status is computed.`,
    },
    answer: {
      type: 'text',
      description:
        "Jev's whole answers as JSON: its choice for each question and, when Jev gives them, the probability of each choice. NULL unless status is computed.",
    },
  } as const;
  // One email for each call and 16 calls at once, as startup-credits'
  // PageKinds: OpenRouter answered 16 requests at once with no refusal
  // (2026-10-31).
  override readonly batch = 1;
  override readonly concurrency = 16;

  override read(
    row: LoadedRow,
  ): { readonly key: string; readonly input: string } | null {
    return typeof row.id === 'string'
      ? { key: row.id, input: emailText(row) }
      : null;
  }

  // The model and the questions make every decision, so a new model or a
  // reworded question decides every email again.
  override async identity(): Promise<string> {
    const questionHash = createHash('sha256')
      .update(JSON.stringify(paymentQuestions))
      .digest('hex')
      .slice(0, 16);
    return `${modelId}:${questionHash}`;
  }

  override async compute(
    states: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly RuleResult<Readonly<Record<string, string>>>[]> {
    return Promise.all(
      states.map(async (state) => {
        try {
          const { answers } = await decide({
            model: this.#model,
            state,
            questions: paymentQuestions,
            abortSignal: signal,
          });
          return {
            value: {
              kind: answers.kind.choice,
              category: answers.category.choice,
              frequency: answers.frequency.choice,
              answer: JSON.stringify(answers),
            },
          };
        } catch (error) {
          // The TypeSafe provider names its own TYPESAFE_AI_API_KEY when it
          // has no key, not the variable ipay reads.
          if (LoadAPIKeyError.isInstance(error))
            throw new Error(
              "ipay asks OpenRouter's Decisions API about each candidate email: set OPENROUTER_API_KEY to your OpenRouter key",
              { cause: error },
            );
          // A refused or malformed answer, and a call that failed after the
          // AI SDK's retries, are this email's failure. A rejected key is
          // not: every email would fail, so the dataset fails. A stop is no
          // failure.
          if (
            Experimental_DecisionRefusalError.isInstance(error) ||
            InvalidResponseDataError.isInstance(error)
          )
            return { error: error.message };
          const call = RetryError.isInstance(error) ? error.lastError : error;
          if (APICallError.isInstance(call) && call.statusCode !== 401)
            return { error: call.message };
          throw error;
        }
      }),
    );
  }
}
