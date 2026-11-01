import type { SQLTagStore } from 'node:sqlite';

import { Coverage } from '@zukhruf/snapshot-differential';
import { z } from 'zod';

import {
  type StoredOffer,
  offerIdentity,
  storedOffersSchema,
  valuedIdentities,
} from '../offer.ts';
import { Alert, type Change, rows } from './alert.ts';

// A computed row has its offers, and an empty row none: the computed dataset
// writes them so.
const offersRow = z.object({
  articleUrl: z.string(),
  offers: z.string().nullable(),
});

// A program page and the kind and value of each of its offers that has a
// value (money, a percent, months).
type Program = { readonly page: string; readonly valued: readonly string[] };

// Each program page, logged as a new program with its offers, none when the
// page states no offer that its text holds, and as offers changed when its
// amounts change. An answer that quotes other words, or that gains or loses
// an offer with no value, such as support, is not a change. A page that
// leaves the table, as when its offer call or its label fails, is not a
// program that ended: the alert keeps it, so a page that comes back with the
// same amounts logs nothing.
export class OfferedPrograms extends Alert<Program> {
  // The offers of each page in the last read, which a new program's line
  // quotes.
  #offers: ReadonlyMap<string, readonly StoredOffer[]> = new Map();

  constructor() {
    super({
      name: 'offered programs',
      primaryKey: ['page'],
      key: ({ page }) => [page],
      policy: new Coverage(() => false),
    });
  }

  protected records(sql: SQLTagStore) {
    this.#offers = new Map(
      rows(
        () =>
          sql.all`SELECT articleUrl, offers FROM program_offers WHERE status IN ('computed', 'empty')`,
      ).map((row) => {
        const { articleUrl, offers } = offersRow.parse(row);
        return [
          articleUrl,
          offers === null ? [] : storedOffersSchema.parse(JSON.parse(offers)),
        ] as const;
      }),
    );
    return [...this.#offers].map(([page, offers]) => ({
      page,
      valued: valuedIdentities(offers).toSorted(),
    }));
  }

  protected line({ type, record: { page, valued } }: Change<Program>) {
    if (type === 'update')
      return `offers changed ${page}: ${valued.length === 0 ? 'none' : valued.join(', ')}`;
    const offers = this.#offers.get(page)!;
    return `new program ${page}: ${offers.length === 0 ? 'no offer found' : offers.map((offer) => `${offerIdentity(offer)} ("${offer.quote}")`).join('; ')}`;
  }
}
