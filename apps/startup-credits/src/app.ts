import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { etag } from 'hono/etag';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import companiesRoute from './routes/companies.route.ts';
import coverageRoute from './routes/coverage.route.ts';
import eventsRoute from './routes/events.route.ts';
import programsRoute from './routes/programs.route.ts';
import queriesRoute from './routes/queries.route.ts';

// The key of each consumer that may call the API, separated by commas. The
// API is private: a consumer is someone Ezz gave a key.
const keys = (process.env.STARTUP_CREDITS_API_KEYS ?? '')
  .split(',')
  .map((key) => key.trim())
  .filter((key) => key !== '');
if (keys.length === 0) {
  throw new Error(
    'Set STARTUP_CREDITS_API_KEYS to the API keys of the consumers, separated by commas.',
  );
}

// The code that an error names beside its status, such as crawl_running.
const causeSchema = z.object({ code: z.string() });

const app = new Hono();
app.use('/v1/*', bearerAuth({ token: keys }), etag());
for (const route of [
  programsRoute,
  companiesRoute,
  eventsRoute,
  queriesRoute,
  coverageRoute,
]) {
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
