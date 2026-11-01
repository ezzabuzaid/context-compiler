import type { SQLTagStore } from 'node:sqlite';

import { ClosedWorld } from '@zukhruf/snapshot-differential';
import { z } from 'zod';

import { Alert, type Change, rows } from './alert.ts';

// A failed row has its error: the computed dataset writes it so.
const failedRow = z.object({ articleUrl: z.string(), error: z.string() });

type ModelFailure = {
  readonly step: 'label' | 'extract';
  readonly page: string;
  readonly reason: string;
};

// Each page that a model could not read: Jev its kind, or Haiku its offers.
// The key is the step and the page, so a page that fails again at each
// refresh is logged once, until it stops failing; another reason for the
// same failure logs nothing.
export class ModelFailures extends Alert<ModelFailure> {
  constructor() {
    super({
      name: 'model failures',
      primaryKey: ['step', 'page'],
      key: ({ step, page }) => [step, page],
      policy: new ClosedWorld(),
    });
  }

  protected records(sql: SQLTagStore) {
    const failures = (
      step: 'label' | 'extract',
      read: () => Record<string, unknown>[],
    ) =>
      rows(read).map((row) => {
        const { articleUrl, error } = failedRow.parse(row);
        return { step, page: articleUrl, reason: error };
      });
    return [
      ...failures(
        'label',
        () =>
          sql.all`SELECT articleUrl, error FROM page_kinds WHERE status = 'failed'`,
      ),
      ...failures(
        'extract',
        () =>
          sql.all`SELECT articleUrl, error FROM program_offers WHERE status = 'failed'`,
      ),
    ];
  }

  protected line({
    type,
    record: { step, page, reason },
  }: Change<ModelFailure>) {
    return type === 'insert' ? `could not ${step} ${page}: ${reason}` : null;
  }
}
