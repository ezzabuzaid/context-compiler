import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { candidates, itemResource } from '../items.ts';
import store from '../store.ts';

// An items cursor is the offset of its page, opaque to the consumer.
const cursorSchema = z.object({ offset: z.number().int().nonnegative() });

const cursorOf = (offset: number) =>
  Buffer.from(JSON.stringify({ offset })).toString('base64url');

function offsetOf(given: string): number {
  let parsed;
  try {
    parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(given, 'base64url').toString()),
    );
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }
  if (parsed === undefined || !parsed.success) {
    throw new HTTPException(400, {
      message: 'The cursor is not one that this API gave',
      cause: { code: 'invalid_cursor' },
    });
  }
  return parsed.data.offset;
}

export default function (router: Hono) {
  /**
   * @openapi listItems
   * @summary List a collection's items
   * @tags items
   * @description The pages of a collection that meet every criterion, each with its evaluations and fields, as Exa lists the items of a webset. An item reaches the API with the event that announces it.
   */
  router.get(
    '/v1/collections/:id/items',
    validate((payload) => ({
      id: { select: payload.params.id, against: z.string() },
      limit: {
        select: payload.query.limit,
        against: z.coerce.number().int().min(1).max(100).default(20),
      },
      cursor: { select: payload.query.cursor, against: z.string().optional() },
    })),
    (c) => {
      const collection = store
        .crawled()
        .find(({ id }) => id === c.var.input.id);
      if (collection === undefined) {
        throw new HTTPException(404, {
          message: 'No such collection',
          cause: { code: 'not_found' },
        });
      }
      const ids = store.itemIds(collection.id);
      const items = candidates(collection).flatMap((page) => {
        const id = ids.get(page.url);
        return page.matches && id !== undefined ? [itemResource(id, page)] : [];
      });
      const { limit: size, cursor: given } = c.var.input;
      const offset = given === undefined ? 0 : offsetOf(given);
      const next = offset + size;
      return c.json({
        data: items.slice(offset, next),
        hasMore: next < items.length,
        nextCursor: next < items.length ? cursorOf(next) : null,
      });
    },
  );
}
