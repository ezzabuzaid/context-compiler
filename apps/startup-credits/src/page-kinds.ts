import { createHash } from 'node:crypto';

import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import {
  APICallError,
  Experimental_DecisionRefusalError,
  InvalidResponseDataError,
  RetryError,
  experimental_decide as decide,
} from 'ai';

import { type LoadedRow, Rule, type RuleResult } from '@workspace/elt';

// A decision model of OpenRouter's Decisions API, by its id. The API speaks
// TypeSafe's wire format at /decisions. OpenRouter's own provider (3.1.0)
// types its model against an older decision spec than ai 7, so the TypeSafe
// provider is pointed at it instead.
export function openRouterDecisionModel(id: string) {
  return createTypeSafeAi({
    baseURL: 'https://openrouter.ai/api/alpha',
    apiKey: process.env.OPENROUTER_API_KEY,
    fetch: (url, init) =>
      fetch(String(url).replace(/\/systemone$/u, '/decisions'), init),
  }).decisionModel(id);
}

// The kinds of page that a list of startup programs links.
export const pageKinds = [
  'program',
  'home',
  'list',
  'article',
  'other_program',
  'investor',
  'other',
] as const;

// The question that labels a page, with one criterion for each kind. The
// page-kind benchmark (eval/) asks the same question.
export const pageKindQuestions = {
  kind: {
    type: 'choice',
    instructions: 'What kind of web page is this?',
    criteria: {
      program: "one company's program page for startups",
      home: "a company's home page or product page",
      list: 'a list or directory of many programs from many companies',
      article: 'a blog post, news article or documentation page',
      other_program: 'a program for students, open source or ambassadors',
      investor: 'a venture fund, investor or accelerator',
      other:
        'a sign-in wall, loading screen, error page or a page with almost no text',
    } satisfies Record<(typeof pageKinds)[number], string>,
  },
} as const;

// What the model reads of a page: its URL, its title and its text, at most
// 20,000 characters. ArticleExtractor gives no title for some pages
// (source-web-pages article-extractor.ts: title is nullable text).
export function pageState(url: string, title: string | null, text: string) {
  return `URL: ${url}\nTitle: ${title ?? ''}\n\n${text}`.slice(0, 20_000);
}

const modelId = 'typesafe/jev-1.14';

// The kind of each stored page, labelled by Jev: the app reads offers only
// from the pages labelled program.
export class PageKinds extends Rule<string, string> {
  readonly #model = openRouterDecisionModel(modelId);

  override readonly key = {
    name: 'articleUrl',
    description: 'The article URL of the labelled page.',
  };
  override readonly output = {
    kind: {
      type: 'text',
      description: `The kind of the page: ${pageKinds.join(', ')}. NULL unless status is computed.`,
    },
    answer: {
      type: 'text',
      description:
        "Jev's whole answer as JSON: its choice and, when Jev gives them, the probability of each kind. NULL unless status is computed.",
    },
  } as const;
  // One page for each call and 16 calls at once: OpenRouter answered 16
  // requests at once with no refusal (2026-10-31).
  override readonly batch = 1;
  override readonly concurrency = 16;

  override read(
    row: LoadedRow,
  ): { readonly key: string; readonly input: string } | null {
    const { articleUrl, title, textContent } = row;
    return typeof articleUrl === 'string' && typeof textContent === 'string'
      ? {
          key: articleUrl,
          input: pageState(
            articleUrl,
            typeof title === 'string' ? title : null,
            textContent,
          ),
        }
      : null;
  }

  // The model and the question make every label, so a new model or a
  // reworded question labels every page again.
  override async identity(): Promise<string> {
    const questionHash = createHash('sha256')
      .update(JSON.stringify(pageKindQuestions))
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
            questions: pageKindQuestions,
            abortSignal: signal,
          });
          return {
            value: {
              kind: answers.kind.choice,
              answer: JSON.stringify(answers.kind),
            },
          };
        } catch (error) {
          // A refused or malformed answer, and a call that failed after the
          // AI SDK's retries, are this page's failure. A rejected key is not:
          // every page would fail, so the dataset fails. A stop is no failure.
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
