import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import * as inputs from '../inputs.ts';
import queue, { monitors } from '../queue.ts';
import store from '../store.ts';

function found(id: string) {
  const monitor = store.monitor(id);
  if (monitor === undefined) {
    throw new HTTPException(404, {
      message: 'No such monitor',
      cause: { code: 'not_found' },
    });
  }
  return monitor;
}

export default function (router: Hono) {
  /**
   * @openapi createMonitor
   * @summary Create a monitor
   * @tags monitors
   * @description Check a target on a cron: a page, whose changes come as unified diffs of its text; a web search, whose new pages come when it finds them; or a dataset, whose search runs again so that its new pages join the dataset. A page or a search monitor reads its baseline now; the baseline of a dataset monitor is the dataset's pages. A run that the app missed while it was stopped runs once after the start. The changes are the monitor's events.
   */
  router.post(
    '/v1/monitors',
    validate((payload) => ({
      name: {
        select: payload.body.name,
        against: z.string().trim().min(1).max(200),
      },
      target: {
        select: payload.body.target,
        against: z.union([
          z.strictObject({ page: inputs.webUrl }),
          z.strictObject({ search: inputs.search }),
          z.strictObject({ dataset: z.string() }),
        ]),
      },
      cron: {
        select: payload.body.cron,
        against: z.string().trim().min(9).max(100),
      },
    })),
    async (c) => {
      const definition = c.var.input;
      const { target } = definition;
      if ('dataset' in target) {
        const dataset = store.dataset(target.dataset);
        if (dataset === undefined) {
          throw new HTTPException(400, {
            message: `No such dataset: ${target.dataset}`,
            cause: { code: 'invalid_argument' },
          });
        }
        if (dataset.search === undefined) {
          throw new HTTPException(400, {
            message:
              "A dataset monitor runs the dataset's search again, so the dataset needs a search",
            cause: { code: 'invalid_argument' },
          });
        }
      }
      const monitor = store.addMonitor(definition);
      try {
        // A run that the app missed while it was stopped, or while the Mac
        // slept, runs once after the start, as anacron runs a missed job.
        await queue.schedule(
          monitors,
          monitor.cron,
          { monitor: monitor.id },
          { key: monitor.id, missed: 'once' },
        );
      } catch (error) {
        store.deleteMonitor(monitor.id);
        throw new HTTPException(400, {
          message: `The cron is not valid: ${Error.isError(error) ? error.message : String(error)}`,
          cause: { code: 'invalid_argument' },
        });
      }
      if (!('dataset' in target)) {
        await queue.send(monitors, { monitor: monitor.id });
      }
      return c.json(monitor, 201, { Location: `/v1/monitors/${monitor.id}` });
    },
  );

  /**
   * @openapi listMonitors
   * @summary List monitors
   * @tags monitors
   * @description The monitors, oldest first, each with how its last run went.
   */
  router.get(
    '/v1/monitors',
    validate(() => ({})),
    (c) => {
      return c.json({ data: store.monitors() });
    },
  );

  /**
   * @openapi getMonitor
   * @summary Get a monitor
   * @tags monitors
   * @description A monitor with how its last run went: none yet, done, or failed with its reason.
   */
  router.get(
    '/v1/monitors/:id',
    validate((payload) => ({
      id: { select: payload.params.id, against: z.string() },
    })),
    (c) => {
      return c.json(found(c.var.input.id));
    },
  );

  /**
   * @openapi deleteMonitor
   * @summary Delete a monitor
   * @tags monitors
   * @description Stop checking a monitor's target. Its events stay in the log.
   */
  router.delete(
    '/v1/monitors/:id',
    validate((payload) => ({
      id: { select: payload.params.id, against: z.string() },
    })),
    async (c) => {
      const { id } = found(c.var.input.id);
      await queue.unschedule(monitors, id);
      store.deleteMonitor(id);
      return c.body(null, 204);
    },
  );
}
