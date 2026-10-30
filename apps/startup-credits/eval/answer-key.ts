import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

const span = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});
export type Span = z.infer<typeof span>;

export const pageKinds = [
  'program',
  'home',
  'list',
  'article',
  'other_program',
  'investor',
  'other',
] as const;
export const offerKinds = [
  'credits',
  'discount',
  'free_period',
  'support',
  'perks',
] as const;

const money = z.object({ amount: z.number(), currency: z.string().length(3) });

const offer = z.object({
  kind: z.enum(offerKinds),
  value: money.nullable(),
  percent: z.number().nullable(),
  duration: z.string().nullable(),
  who: z.string().nullable(),
  // Every place where the page states this offer; the first is the clearest.
  mentions: z.array(span).nonempty(),
});

const lookalike = span.extend({
  reason: z.enum([
    'eligibility',
    'how_to_apply',
    'regular_pricing',
    'testimonial',
    'product',
    'partner_list',
    'marketing',
    'faq',
    'other',
  ]),
});

const label = z.object({
  url: z.string(),
  sha256: z.string(),
  // A page that an extractor shows as a worked example is left out of its
  // scores, so a design is never scored on its own examples.
  role: z.enum(['test', 'example']),
  kind: z.enum(pageKinds),
  offers: z.array(offer),
  lookalikes: z.array(lookalike),
  note: z.string().optional(),
});
export type Label = z.infer<typeof label>;

const answerKeySchema = z.object({
  // When the labels were frozen, before any design was scored on them.
  frozenAt: z.string(),
  annotator: z.string(),
  // The loaded_at time of the live run that the cache froze.
  run: z.string(),
  pages: z.array(label),
});
export type AnswerKey = z.infer<typeof answerKeySchema>;

export function answerKey(): AnswerKey {
  return answerKeySchema.parse(
    JSON.parse(
      readFileSync(join(import.meta.dirname, 'answer-key.json'), 'utf8'),
    ),
  );
}
