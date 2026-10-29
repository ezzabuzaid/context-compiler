import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import eventsRoute from './routes/events.route.ts';
import interestsRoute from './routes/interests.route.ts';
import linesRoute from './routes/lines.route.ts';
import sourcesRoute from './routes/sources.route.ts';
import { controlsSchema } from './views/controls.ts';
import { layout } from './views/layout.ts';
import { markup } from './views/markup.ts';

// The fields that sdk-it's validate refused, each with its zod issues.
const refusedSchema = z.object({
  errors: z.record(z.string(), z.array(z.object({ code: z.string() }))),
});

const app = new Hono();
for (const route of [linesRoute, eventsRoute, interestsRoute, sourcesRoute]) {
  route(app);
}
app.onError((error, c) => {
  const refused = refusedSchema.safeParse(
    error instanceof HTTPException ? error.cause : undefined,
  );
  if (error instanceof HTTPException && refused.success) {
    const problems = Object.entries(refused.data.errors).map(
      ([field, issues]) =>
        `${field.charAt(0).toUpperCase()}${field.slice(1)} ${
          issues.some(({ code }) => code === 'too_small')
            ? 'is empty'
            : 'is not valid'
        }.`,
    );
    return c.html(
      layout({
        title: 'Not saved - What is going on',
        hours: controlsSchema.hours.parse(undefined),
        main: markup`<div class="about"><h3>Not saved</h3><ul>${problems.map(
          (problem) => markup`<li>${problem}</li>`,
        )}</ul><p><a href="${c.req.header('referer') ?? '/'}">Back</a></p></div>`,
      }).toString(),
      error.status,
    );
  }
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
