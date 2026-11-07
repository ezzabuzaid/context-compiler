import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import store from '../store.ts';

export default function (router: Hono) {
  /**
   * @openapi listEvents
   * @tags events
   * @description What happened to a collection's items after the consumer's cursor, as a delta query answers: item.created, item.updated (with the fields before it) and item.removed. A cursor of an earlier log answers 410 resync_required.
   */
  router.get(
    '/v1/collections/:id/events',
    validate((payload) => ({
      id: { select: payload.params.id, against: z.string() },
      limit: {
        select: payload.query.limit,
        against: z.coerce.number().int().min(1).max(500).default(100),
      },
      cursor: { select: payload.query.cursor, against: z.string().optional() },
    })),
    (c) => {
      const { id } = c.var.input;
      if (store.collection(id) === undefined) {
        throw new HTTPException(404, {
          message: 'No such collection',
          cause: { code: 'not_found' },
        });
      }
      const events = store.events(id, c.var.input.cursor, c.var.input.limit);
      if (events === 'gone') {
        throw new HTTPException(410, {
          message:
            'The event log started again, so the cursor is gone: list the items again, then read the events from the new start',
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
