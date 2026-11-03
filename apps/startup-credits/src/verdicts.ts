import { z } from 'zod';

import { rows } from './alerts/alert.ts';
import { type ProgramResource, programResources } from './programs.ts';
import type { Query } from './store.ts';
import warehouse from './warehouse.ts';

// A computed row has the model's answer, a failed row why the call failed,
// as the criterion's dataset writes them.
const verdictRow = z.discriminatedUnion('status', [
  z.object({
    criterion: z.string(),
    articleUrl: z.string(),
    status: z.literal('computed'),
    meets: z.enum(['yes', 'no']),
    reason: z.string(),
    quote: z.string().nullable(),
  }),
  z.object({
    criterion: z.string(),
    articleUrl: z.string(),
    status: z.literal('failed'),
    error: z.string(),
  }),
]);

// The verdict on one criterion of a query for one program: not judged yet,
// a call that failed, or the model's answer with its reason and the sentence
// that decides.
export type Verdict =
  | { readonly criterion: string; readonly state: 'pending' }
  | {
      readonly criterion: string;
      readonly state: 'failed';
      readonly error: string;
    }
  | {
      readonly criterion: string;
      readonly state: 'judged';
      readonly meets: boolean;
      readonly reason: string;
      readonly quote: string | null;
    };

type Item = {
  readonly program: ProgramResource;
  readonly verdicts: readonly Verdict[];
  readonly matches: boolean;
};

function verdict(
  criterion: string,
  row: z.infer<typeof verdictRow> | undefined,
): Verdict {
  if (row === undefined) {
    return { criterion, state: 'pending' };
  }
  if (row.status === 'failed') {
    return { criterion, state: 'failed', error: row.error };
  }
  return {
    criterion,
    state: 'judged',
    meets: row.meets === 'yes',
    reason: row.reason,
    quote: row.quote,
  };
}

// Each program with its verdict on each criterion of the query. A program
// matches when the model judged every criterion and every one holds.
export function items(query: Query): readonly Item[] {
  const verdicts = new Map(
    rows(() => warehouse.sql.all`SELECT * FROM verdicts`).map((row) => {
      const parsed = verdictRow.parse(row);
      return [`${parsed.criterion}\n${parsed.articleUrl}`, parsed] as const;
    }),
  );
  return programResources().map((program) => {
    const judged = query.criteria.map(({ name, description }) =>
      verdict(name, verdicts.get(`${description}\n${program.url}`)),
    );
    return {
      program,
      verdicts: judged,
      matches: judged.every((given) => given.state === 'judged' && given.meets),
    };
  });
}
