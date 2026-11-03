import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import store from '../store.ts';

const limit = z.coerce.number().int().min(1).max(500).default(100);
const cursor = z.string().optional();

export default function (router: Hono) {
  // What happened to a collection's items after the consumer's cursor, as a
  // delta query answers: item.created, item.updated (with the fields before
  // it) and item.removed.
  router.get(
    '/v1/collections/:id/events',
    validate((payload) => ({
      limit: { select: payload.query.limit, against: limit },
      cursor: { select: payload.query.cursor, against: cursor },
    })),
    (c) => {
      const id = c.req.param('id');
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
