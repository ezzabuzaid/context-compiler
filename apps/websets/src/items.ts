import { z } from 'zod';

import type { Crawled } from './store.ts';
import { sql } from './warehouse.ts';

// Rows of a view that the first pipeline makes for the datasets, and none
// before it.
function rows(read: () => Record<string, unknown>[]) {
  try {
    return read();
  } catch (error) {
    if (Error.isError(error) && /^no such table/u.test(error.message)) {
      return [];
    }
    throw error;
  }
}

const candidateRow = z.object({
  inputUrl: z.string(),
  articleUrl: z.string(),
  title: z.string().nullable(),
  loaded_at: z.string(),
});
// A computed row has the model's answer, a failed row why the call failed,
// as a computed dataset writes them.
const evaluationRow = z.discriminatedUnion('status', [
  z.object({
    criterion: z.number(),
    articleUrl: z.string(),
    status: z.literal('computed'),
    satisfied: z.enum(['yes', 'no', 'unclear']),
    reasoning: z.string(),
    quote: z.string().nullable(),
  }),
  z.object({
    criterion: z.number(),
    articleUrl: z.string(),
    status: z.literal('failed'),
    error: z.string(),
  }),
]);
const fieldRow = z.discriminatedUnion('status', [
  z.object({
    field: z.string(),
    articleUrl: z.string(),
    status: z.literal('computed'),
    value: z.string(),
    quote: z.string().nullable(),
  }),
  z.object({
    field: z.string(),
    articleUrl: z.string(),
    status: z.literal('failed'),
    error: z.string(),
  }),
]);

// How one criterion went for one page: not judged yet, a call that failed,
// or the model's answer with its reasoning and the sentence that decides,
// as Exa's Websets give an evaluation.
type Evaluation =
  | { readonly criterion: string; readonly state: 'pending' }
  | {
      readonly criterion: string;
      readonly state: 'failed';
      readonly error: string;
    }
  | {
      readonly criterion: string;
      readonly state: 'judged';
      readonly satisfied: 'yes' | 'no' | 'unclear';
      readonly reasoning: string;
      readonly quote: string | null;
    };

// One field of a page that meets every criterion: not read yet, a call that
// failed, or its value with the sentence that states it.
type FieldResult =
  | { readonly state: 'pending' }
  | { readonly state: 'failed'; readonly error: string }
  | {
      readonly state: 'read';
      readonly value: unknown;
      readonly quote: string | null;
    };

// A page of a dataset: where it came from, how each criterion went, and,
// once it meets every criterion, its fields.
export type Candidate = {
  readonly url: string;
  readonly title: string | null;
  readonly source: 'search' | 'page' | 'list';
  readonly loadedAt: string;
  readonly evaluations: readonly Evaluation[];
  readonly matches: boolean;
  readonly fields: Readonly<Record<string, FieldResult>>;
};

export function candidates(dataset: Crawled): readonly Candidate[] {
  const { id, criteria, fields, seeds, pages } = dataset;
  const evaluations = new Map(
    rows(
      () =>
        sql.all`SELECT criterion, articleUrl, status, error, satisfied, reasoning, quote FROM evaluations WHERE dataset = ${id}`,
    ).map((row) => {
      const parsed = evaluationRow.parse(row);
      return [`${parsed.criterion}\n${parsed.articleUrl}`, parsed] as const;
    }),
  );
  const values = new Map(
    rows(
      () =>
        sql.all`SELECT field, articleUrl, status, error, value, quote FROM field_values WHERE dataset = ${id}`,
    ).map((row) => {
      const parsed = fieldRow.parse(row);
      return [`${parsed.field}\n${parsed.articleUrl}`, parsed] as const;
    }),
  );
  return rows(
    () =>
      sql.all`SELECT inputUrl, articleUrl, title, loaded_at FROM candidates WHERE dataset = ${id} ORDER BY articleUrl`,
  ).map((row) => {
    const page = candidateRow.parse(row);
    const judged = criteria.map(({ description }, index): Evaluation => {
      const given = evaluations.get(`${index}\n${page.articleUrl}`);
      if (given === undefined) {
        return { criterion: description, state: 'pending' };
      }
      return given.status === 'failed'
        ? { criterion: description, state: 'failed', error: given.error }
        : {
            criterion: description,
            state: 'judged',
            satisfied: given.satisfied,
            reasoning: given.reasoning,
            quote: given.quote,
          };
    });
    const matches = judged.every(
      (given) => given.state === 'judged' && given.satisfied === 'yes',
    );
    let source: Candidate['source'] = 'list';
    if (seeds.includes(page.inputUrl)) {
      source = 'search';
    } else if (pages.includes(page.inputUrl)) {
      source = 'page';
    }
    return {
      url: page.articleUrl,
      title: page.title,
      source,
      loadedAt: page.loaded_at,
      evaluations: judged,
      matches,
      fields: Object.fromEntries(
        fields.map(({ name }): [string, FieldResult] => {
          const given = values.get(`${name}\n${page.articleUrl}`);
          if (given === undefined) {
            return [name, { state: 'pending' }];
          }
          return [
            name,
            given.status === 'failed'
              ? { state: 'failed', error: given.error }
              : {
                  state: 'read',
                  value: JSON.parse(given.value),
                  quote: given.quote,
                },
          ];
        }),
      ),
    };
  });
}

// An item as the API gives it: a page of the dataset, with the id that the
// event log gave it.
export const itemResource = (
  id: string,
  { matches: _, ...page }: Candidate,
) => ({ id, ...page });
export type Item = ReturnType<typeof itemResource>;
