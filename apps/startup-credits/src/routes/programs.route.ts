import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { currentAsOf, programResources } from '../programs.ts';

const pageSize = z.coerce.number().int().min(1).max(200).default(50);
const pageToken = z.string().optional();
// A page token is the offset of its page, opaque to the consumer (AIP-158).
const tokenSchema = z.object({ offset: z.number().int().nonnegative() });

const token = (offset: number) =>
  Buffer.from(JSON.stringify({ offset })).toString('base64url');

function offsetOf(given: string): number {
  let parsed;
  try {
    parsed = tokenSchema.safeParse(
      JSON.parse(Buffer.from(given, 'base64url').toString()),
    );
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }
  if (parsed === undefined || !parsed.success) {
    throw new HTTPException(400, {
      message: 'The page token is not one that this API gave',
      cause: { code: 'invalid_page_token' },
    });
  }
  return parsed.data.offset;
}

export default function (router: Hono) {
  router.get(
    '/v1/programs',
    validate((payload) => ({
      size: { select: payload.query.page_size, against: pageSize },
      token: { select: payload.query.page_token, against: pageToken },
    })),
    (c) => {
      const { size, token: given } = c.var.input;
      const offset = given === undefined ? 0 : offsetOf(given);
      const programs = programResources();
      const next = offset + size;
      return c.json({
        programs: programs.slice(offset, next),
        nextPageToken: next < programs.length ? token(next) : null,
        currentAsOf: currentAsOf(),
      });
    },
  );

  router.get('/v1/programs/:id', (c) => {
    const program = programResources().find(
      ({ id }) => id === c.req.param('id'),
    );
    if (program === undefined) {
      throw new HTTPException(404, {
        message: 'No such program',
        cause: { code: 'not_found' },
      });
    }
    return c.json(program);
  });
}
