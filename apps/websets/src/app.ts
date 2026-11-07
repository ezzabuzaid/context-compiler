import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { etag } from 'hono/etag';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import collectionsRoute from './routes/collections.route.ts';
import eventsRoute from './routes/events.route.ts';
import itemsRoute from './routes/items.route.ts';

// The key of each consumer that may call the API, separated by commas. The
// API is private: a consumer is someone Ezz gave a key.
const keys = (process.env.WEBSETS_API_KEYS ?? '')
  .split(',')
  .map((key) => key.trim())
  .filter((key) => key !== '');
if (keys.length === 0) {
  throw new Error(
    'Set WEBSETS_API_KEYS to the API keys of the consumers, separated by commas.',
  );
}

// The code that an error names beside its status, such as crawl_running.
const causeSchema = z.object({ code: z.string() });
// sdk-it's validate fails an input with its own code and the errors of each
// field; the API names every invalid input invalid_argument.
const validationSchema = z.object({
  code: z.literal('api/validation-failed'),
  errors: z.record(z.string(), z.unknown()),
});

const app = new Hono();
// bearerAuth answers in the API's error shape, beside its WWW-Authenticate
// challenge: 401 unauthenticated without a key or with a wrong one, and 400
// when the Authorization header is not a bearer token.
const unauthenticated = {
  message: {
    error: {
      code: 'unauthenticated',
      message: 'Give an API key of this API as a bearer token',
    },
  },
};
app.use(
  '/v1/*',
  bearerAuth({
    token: keys,
    noAuthenticationHeader: unauthenticated,
    invalidToken: unauthenticated,
    invalidAuthenticationHeader: {
      message: {
        error: {
          code: 'invalid_argument',
          message: 'The Authorization header is not a bearer token',
        },
      },
    },
  }),
  etag(),
);
for (const route of [collectionsRoute, itemsRoute, eventsRoute]) {
  route(app);
}
app.notFound((c) =>
  c.json({ error: { code: 'not_found', message: 'No such resource' } }, 404),
);
app.onError((error, c) => {
  if (!(error instanceof HTTPException)) {
    console.error(error);
    return c.json(
      { error: { code: 'internal', message: 'Internal Server Error' } },
      500,
    );
  }
  // bearerAuth's 401 carries its WWW-Authenticate challenge.
  if (error.res !== undefined) {
    return error.getResponse();
  }
  const validation = validationSchema.safeParse(error.cause);
  if (validation.success) {
    return c.json(
      {
        error: {
          code: 'invalid_argument',
          message: error.message,
          detail: { fields: validation.data.errors },
        },
      },
      400,
    );
  }
  const cause = causeSchema.safeParse(error.cause);
  return c.json(
    {
      error: {
        code: cause.success ? cause.data.code : 'invalid_argument',
        message: error.message,
        ...(cause.success ? {} : { detail: error.cause }),
      },
    },
    error.status,
  );
});

export default app;
