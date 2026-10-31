import { z } from 'zod';

import type { Span } from './ground.ts';

const money = z
  .object({ amount: z.number(), currency: z.string().regex(/^[A-Z]{3}$/u) })
  .nullable();
const quote = z.string().min(1);
const who = z.string().nullable();

// One thing that a program page gives startups, as the model states it. The
// quote comes first, so the model copies the sentence before it reads the
// kind and the value from it.
const offer = z.discriminatedUnion('kind', [
  z.object({
    quote,
    kind: z.literal('credits'),
    value: money,
    duration: z.string().nullable(),
    who,
  }),
  z.object({
    quote,
    kind: z.literal('discount'),
    percent: z.number().nullable(),
    duration: z.string().nullable(),
    who,
  }),
  // The length of a free period in months, a year being 12. null when the
  // page states no length, such as "for as long as you are eligible".
  z.object({
    quote,
    kind: z.literal('free_period'),
    months: z.number().nullable(),
    who,
  }),
  z.object({ quote, kind: z.literal('support'), who }),
  z.object({ quote, kind: z.literal('perks'), value: money, who }),
]);

// What the model answers for one page.
export const offersSchema = z.object({ offers: z.array(offer) });
export type Offer = z.infer<typeof offer>;

const span = z.object({
  start: z.number().int(),
  end: z.number().int(),
}) satisfies z.ZodType<Span>;

// An offer as the dataset keeps it: the model's offer and where its quote is
// in the page text.
export const storedOffersSchema = z.array(
  z.intersection(offer, z.object({ span })),
);
export type StoredOffer = z.infer<typeof storedOffersSchema>[number];

// The value that tells one offer of a kind from another, as an alert shows
// it: the money of credits and perks, the percent of a discount, the months
// of a free period. null for an offer that states no value, such as
// support.
export function offerValue(offer: Offer): string | null {
  switch (offer.kind) {
    case 'credits':
    case 'perks':
      return offer.value === null
        ? null
        : new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: offer.value.currency,
            trailingZeroDisplay: 'stripIfInteger',
          }).format(offer.value.amount);
    case 'discount':
      return offer.percent === null ? null : `${offer.percent}%`;
    case 'free_period':
      return offer.months === null
        ? null
        : new Intl.NumberFormat('en-US', {
            style: 'unit',
            unit: 'month',
            unitDisplay: 'long',
          }).format(offer.months);
    case 'support':
      return null;
  }
}

// The kind of an offer and its value, such as "credits $30,000" or
// "support".
export function offerIdentity(offer: Offer): string {
  const value = offerValue(offer);
  return value === null ? offer.kind : `${offer.kind} ${value}`;
}

// The identities of the offers that have a value: what makes the offers of a
// program change.
export const valuedIdentities = (offers: readonly Offer[]) =>
  offers.flatMap((offer) =>
    offerValue(offer) === null ? [] : [offerIdentity(offer)],
  );
