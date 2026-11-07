import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import store from '../store.ts';

export default function (router: Hono) {
  /**
   * @openapi listMonitorEvents
   * @summary List a monitor's events
   * @tags monitors
   * @description What a monitor's runs found changed after the consumer's cursor: page.changed with a unified diff of the page's text, and search.found with the pages that the search had not found before. A cursor of an earlier log answers 410 resync_required.
   */
  router.get(
    '/v1/monitors/:id/events',
    validate((payload) => ({
      id: { select: payload.params.id, against: z.string() },
      limit: {
        select: payload.query.limit,
        against: z.coerce.number().int().min(1).max(500).default(100),
      },
      cursor: { select: payload.query.cursor, against: z.string().optional() },
    })),
    (c) => {
      const { id, cursor, limit } = c.var.input;
      if (store.monitor(id) === undefined) {
        throw new HTTPException(404, {
          message: 'No such monitor',
          cause: { code: 'not_found' },
        });
      }
      const events = store.monitorEvents(id, cursor, limit);
      // As routes/events.route.ts answers a cursor (docs/copied-code.md).
      if (events === 'gone') {
        throw new HTTPException(410, {
          message:
            'The event log started again, so the cursor is gone: read the events from the new start',
          cause: { code: 'resync_required' },
        });
      }
      if (events === 'invalid') {
        throw new HTTPException(400, {
          message: 'The cursor is not one that this API gave',
          cause: { code: 'invalid_cursor' },
        });
      }
      return c.json(events);
    },
  );
}
