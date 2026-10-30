import { z } from 'zod';

import { type LoadedRow, Rule, type RuleResult } from '@workspace/elt';

export const amountsSchema = z.array(
  z.object({ amount: z.string(), sentence: z.string() }),
);
export type Amounts = z.infer<typeof amountsSchema>;

// A dollar amount as programs write it: $200,000, $350k, $1.5 million.
const dollars = /\$\s?\d+(?:[.,]\d+)*(?:\s?(?:k|m|thousand|million)\b)?/giu;

// The credit amounts that a page states, each with its sentence: every
// sentence that names credits and a dollar amount. A page that states two
// offers, such as Anthropic's partner perks and its API credits, keeps both.
export function creditAmounts(text: string): Amounts {
  const found = new Map<string, Amounts[number]>();
  for (const line of text.split(/\n+|(?<=[.!?])\s+/u)) {
    const sentence = line.replace(/\s+/gu, ' ').trim();
    if (!/credit/iu.test(sentence)) continue;
    for (const [amount] of sentence.matchAll(dollars))
      found.set(`${amount}\n${sentence}`, { amount, sentence });
  }
  return [...found.values()];
}

// The credit amounts of each stored page, as derived data: a rule over the
// page text, with no model, since the amounts are written out in the page.
export class CreditAmounts extends Rule<string, string> {
  override readonly key = {
    name: 'articleUrl',
    description: 'The article URL of the page that states the amounts.',
  };
  override readonly output = {
    amounts: {
      type: 'text',
      description:
        'A JSON array of { amount, sentence }, one for each credit amount the page states. NULL unless status is computed; a page that states none is empty.',
    },
  } as const;
  override readonly batch = 100;
  override readonly concurrency = 1;

  override read(
    row: LoadedRow,
  ): { readonly key: string; readonly input: string } | null {
    const { articleUrl, textContent } = row;
    return typeof articleUrl === 'string' && typeof textContent === 'string'
      ? { key: articleUrl, input: textContent }
      : null;
  }

  // Changed by hand when creditAmounts changes, so every page is read again.
  override async identity(): Promise<string> {
    return 'credit-amounts-1';
  }

  override async compute(
    texts: readonly string[],
  ): Promise<readonly RuleResult<Readonly<Record<string, string>>>[]> {
    return texts.map((text) => {
      const amounts = creditAmounts(text);
      return amounts.length === 0
        ? { empty: true }
        : { value: { amounts: JSON.stringify(amounts) } };
    });
  }
}
