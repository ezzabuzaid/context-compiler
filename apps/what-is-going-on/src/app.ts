import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import eventsRoute from './routes/events.route.ts';
import interestsRoute from './routes/interests.route.ts';
import linesRoute from './routes/lines.route.ts';
import sourcesRoute from './routes/sources.route.ts';

const app = new Hono();
for (const route of [linesRoute, eventsRoute, interestsRoute, sourcesRoute]) {
  route(app);
}
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.text(
      `${error.message}${error.cause === undefined ? '' : `\n${JSON.stringify(error.cause, null, 2)}`}`,
      error.status,
    );
  }
  console.error(error);
  return c.text('Internal Server Error', 500);
});

export default app;
