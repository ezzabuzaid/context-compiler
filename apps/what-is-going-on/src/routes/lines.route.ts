import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import events, { type Line } from '../events.ts';
import ranking from '../ranking.ts';
import settings, { type Interest } from '../settings.ts';
import { controls, controlsSchema } from '../views/controls.ts';
import { layout } from '../views/layout.ts';
import { backSchema, line } from '../views/line.ts';
import { markup } from '../views/markup.ts';

function list(
  lines: readonly Line[],
  limit: number,
  back: string,
  interest?: Interest,
) {
  const follows = settings.follows();
  return markup`<ul>${lines
    .slice(0, limit)
    .map((item) =>
      line(item, { follows, back, interest: interest?.name }),
    )}</ul>`;
}

const back = (url: string) => {
  const { pathname, search } = new URL(url);
  return pathname + search;
};

export default function (router: Hono) {
  // A column per interest that has lines in the window.
  router.get(
    '/',
    validate((payload) => ({
      limit: { select: payload.query.limit, against: controlsSchema.limit },
      hours: { select: payload.query.hours, against: controlsSchema.hours },
    })),
    async (c) => {
      const { limit, hours } = c.var.input;
      const interests = settings.interests();
      const lines = events.lines({ hours });
      const columns = (
        await Promise.all(
          interests.map(async (interest) => ({
            interest,
            lines: await ranking.rank(interest, lines),
          })),
        )
      ).filter((column) => column.lines.length > 0);
      return c.html(
        await layout({
          title: 'What is going on',
          hours,
          limit,
          controls: controls('/', { limit, hours }),
          main:
            interests.length === 0
              ? markup`<p>You have no interests yet. <a href="/interests">Add one</a>.</p>`
              : columns.length === 0
                ? markup`<p>Nothing matches your interests in this window. <a href="/not-matched?hours=${hours}">See what did not match</a>.</p>`
                : markup`<div class="brutal-grid">${columns.map(
                    ({ interest, lines }) =>
                      markup`<div><h3><a class="source" href="/interest/${encodeURIComponent(interest.name)}">${interest.name}</a></h3>${list(lines, limit, back(c.req.url), interest)}</div>`,
                  )}</div>`,
        }),
      );
    },
  );

  router.get(
    '/interest/:name',
    validate((payload) => ({
      name: { select: payload.params.name, against: z.string() },
      limit: { select: payload.query.limit, against: controlsSchema.limit },
      hours: { select: payload.query.hours, against: controlsSchema.hours },
    })),
    async (c) => {
      const { name, limit, hours } = c.var.input;
      const interest = settings
        .interests()
        .find((interest) => interest.name === name);
      if (interest === undefined)
        throw new HTTPException(404, { message: 'No such interest' });
      return c.html(
        await layout({
          title: `${interest.name} - What is going on`,
          hours,
          limit,
          controls: controls(c.req.path, { limit, hours }),
          main: markup`<div class="about"><h3>${interest.name}</h3><p>${interest.sentence}. [${interest.keywords.join(', ')}]</p>${list(
            await ranking.rank(interest, events.lines({ hours })),
            limit,
            back(c.req.url),
            interest,
          )}</div>`,
        }),
      );
    },
  );

  router.get(
    '/not-matched',
    validate((payload) => ({
      limit: { select: payload.query.limit, against: controlsSchema.limit },
      hours: { select: payload.query.hours, against: controlsSchema.hours },
    })),
    async (c) => {
      const { limit, hours } = c.var.input;
      return c.html(
        await layout({
          title: 'Not matched - What is going on',
          hours,
          limit,
          controls: controls('/not-matched', { limit, hours }),
          main: markup`<div class="about"><h3>Not matched</h3>${list(
            await ranking.unmatched(
              settings.interests(),
              events.lines({ hours }),
              limit,
            ),
            limit,
            back(c.req.url),
          )}</div>`,
        }),
      );
    },
  );

  // [x], [yes] and [no]: the user's answer about a report under an interest.
  router.post(
    '/interest/:name/answers',
    validate((payload) => ({
      name: { select: payload.params.name, against: z.string().min(1) },
      report: { select: payload.body.report, against: z.string().min(1) },
      verdict: { select: payload.body.verdict, against: z.enum(['yes', 'no']) },
      back: { select: payload.body.back, against: backSchema },
    })),
    (c) => {
      const { name, report, verdict } = c.var.input;
      settings.answer(name, report, verdict);
      return c.redirect(c.var.input.back, 303);
    },
  );
}
