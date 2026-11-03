import { getDomain } from 'tldts';
import { z } from 'zod';

import { rows } from './alerts/alert.ts';
import {
  type StoredOffer,
  storedOffersSchema,
  valuedIdentities,
} from './offer.ts';
import store from './store.ts';
import warehouse from './warehouse.ts';

// A program page as the warehouse holds it, with the offers that the offer
// model read from it.
type StoredProgram = {
  readonly articleUrl: string;
  readonly title: string | null;
  readonly siteName: string | null;
  readonly loadedAt: string;
  readonly offers: readonly StoredOffer[];
  // The kind and value of each offer that has one: what makes a program
  // change, as the console alert decides.
  readonly valued: readonly string[];
};

const programRow = z.object({
  articleUrl: z.string(),
  offers: z.string().nullable(),
  title: z.string().nullable(),
  siteName: z.string().nullable(),
  loadedAt: z.string(),
});

// Each program page whose offers the model read: a computed row has its
// offers, an empty row none. A page that two inputs store is one program, as
// it was last stored.
export function storedPrograms(): readonly StoredProgram[] {
  return rows(
    () => warehouse.sql
      .all`SELECT o.articleUrl, o.offers, p.title, p.siteName, MAX(p.loaded_at) AS loadedAt
      FROM program_offers o JOIN stored_pages p USING (articleUrl)
      WHERE o.status IN ('computed', 'empty')
      GROUP BY o.articleUrl ORDER BY o.articleUrl`,
  ).map((row) => {
    const { offers, ...program } = programRow.parse(row);
    const stored =
      offers === null ? [] : storedOffersSchema.parse(JSON.parse(offers));
    return {
      ...program,
      offers: stored,
      valued: valuedIdentities(stored).toSorted(),
    };
  });
}

// How current the warehouse is: the time the crawl last read every page it
// knew, as elt's sync history records it, or null before a pass completed.
export function currentAsOf(): string | null {
  const [status] = rows(
    () =>
      warehouse.sql
        .all`SELECT current_as_of FROM sync_status WHERE connector = 'web'`,
  );
  return status === undefined
    ? null
    : z.object({ current_as_of: z.string().nullable() }).parse(status)
        .current_as_of;
}

// An amount in the smallest unit of its currency, as Stripe sends money, so
// no float rounds it.
function money({ amount, currency }: { amount: number; currency: string }) {
  const { maximumFractionDigits } = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions();
  return {
    amount: Math.round(amount * 10 ** (maximumFractionDigits ?? 2)),
    currency: currency.toLowerCase(),
  };
}

function offer({ quote, span: _, ...stated }: StoredOffer) {
  const valued =
    'value' in stated && stated.value !== null
      ? { ...stated, value: money(stated.value) }
      : stated;
  return { ...valued, evidence: { quote } };
}

// The offers of a program as the API gives them.
export const offerResources = ({ offers }: StoredProgram) => offers.map(offer);

// A program as the API gives it: the company is the registrable domain of
// its page, such as google.com for cloud.google.com/startup, named as the
// page names its website.
export function programResource(id: string, program: StoredProgram) {
  const domain =
    getDomain(program.articleUrl) ?? new URL(program.articleUrl).hostname;
  return {
    id,
    url: program.articleUrl,
    title: program.title,
    company: { domain, name: program.siteName ?? domain },
    offers: offerResources(program),
    loadedAt: program.loadedAt,
  };
}
export type ProgramResource = ReturnType<typeof programResource>;

// The programs that the event log has given an id, as the API gives them: a
// program reaches the API with the event that announces it.
export function programResources(): readonly ProgramResource[] {
  const ids = store.programIds();
  return storedPrograms().flatMap((program) => {
    const id = ids.get(program.articleUrl);
    return id === undefined ? [] : [programResource(id, program)];
  });
}
