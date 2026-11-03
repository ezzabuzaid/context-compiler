import { validate } from '@sdk-it/hono/runtime';
import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import store from '../store.ts';

const pageSize = z.coerce.number().int().min(1).max(500).default(100);
const cursor = z.string().optional();

// One page of the event log after the consumer's cursor, as a delta query
// answers: the events and the cursor to ask with next.
function page(
  c: Context,
  queryId: string | null,
  { size, after }: { size: number; after?: string },
) {
  const events = store.events(queryId, after, size);
  if (events === 'gone') {
    throw new HTTPException(410, {
      message:
        'The event log started again, so the cursor is gone: list the resources again, then read the events from the new start',
      cause: { code: 'resync_required' },
    });
  }
  if (events === 'invalid') {
    throw new HTTPException(400, {
      message: 'The cursor is not one that this API gave',
      cause: { code: 'invalid_cursor' },
    });
  }
  return c.json({ events: events.events, nextCursor: events.next });
}

const paging = validate((payload) => ({
  size: { select: payload.query.page_size, against: pageSize },
  after: { select: payload.query.cursor, against: cursor },
}));

export default function (router: Hono) {
  // What happened to the programs: program.added and program.changed.
  router.get('/v1/events', paging, (c) => page(c, null, c.var.input));

  // What happened to one query's matches: item.matched and item.unmatched.
  router.get('/v1/queries/:id/events', paging, (c) => {
    const queryId = c.req.param('id');
    if (store.query(queryId) === undefined) {
      throw new HTTPException(404, {
        message: 'No such query',
        cause: { code: 'not_found' },
      });
    }
    return page(c, queryId, c.var.input);
  });
}
