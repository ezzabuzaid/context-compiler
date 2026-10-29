import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import events, { type Report } from '../events.ts';
import settings from '../settings.ts';
import { controlsSchema } from '../views/controls.ts';
import { layout } from '../views/layout.ts';
import { age, backSchema, followAction } from '../views/line.ts';
import { markup } from '../views/markup.ts';

const eventId = z.coerce.number().int().nonnegative();

// The report that heads an event: its earliest lab report.
const head = (reports: readonly Report[]) =>
  reports.find(({ kind }) => kind === 'lab') ?? reports[0];

const report = ({ url, title, source, published_at }: Report) =>
  markup`<li><a href="${url}">${title}</a> [${source}] ${age(published_at)}</li>`;

export default function (router: Hono) {
  // Every report of one event, oldest first.
  router.get(
    '/event/:id',
    validate((payload) => ({
      id: { select: payload.params.id, against: eventId },
    })),
    (c) => {
      const { id } = c.var.input;
      const reports = events.event(id);
      const first = head(reports);
      if (first === undefined)
        throw new HTTPException(404, { message: 'No such event' });
      const publishers = new Set(reports.map(({ source }) => source)).size;
      return c.html(
        layout({
          title: `${first.title} - What is going on`,
          hours: controlsSchema.hours.parse(undefined),
          main: markup`<div class="about"><h3><a class="source" href="${first.url}">${first.title}</a></h3><p>${reports.length} reports from ${publishers} publishers ${followAction(
            id,
            settings.follows().has(id),
            c.req.path,
          )}</p><ul>${reports.map(report)}</ul></div>`,
        }),
      );
    },
  );

  for (const [verb, apply] of [
    ['follow', settings.follow],
    ['unfollow', settings.unfollow],
  ] as const)
    router.post(
      `/event/:id/${verb}`,
      validate((payload) => ({
        id: { select: payload.params.id, against: eventId },
        back: { select: payload.body.back, against: backSchema },
      })),
      (c) => {
        apply(c.var.input.id);
        return c.redirect(c.var.input.back, 303);
      },
    );

  // Each followed event with the reports that joined it since following.
  router.get('/following', (c) => {
    const followed = [...settings.follows()].flatMap(([event, at]) => {
      const reports = events.event(event);
      const first = head(reports);
      return first === undefined
        ? []
        : [
            {
              event,
              at,
              first,
              fresh: reports
                .filter(({ stored_at }) => stored_at > at)
                .toSorted((a, b) => b.published_at - a.published_at),
            },
          ];
    });
    return c.html(
      layout({
        title: 'Following - What is going on',
        hours: controlsSchema.hours.parse(undefined),
        main:
          followed.length === 0
            ? markup`<p>You follow no events. Click [follow] on a line to get new reports about it here.</p>`
            : markup`<div class="about">${followed.map(
                ({ event, at, first, fresh }) =>
                  markup`<div><h3><a class="source" href="/event/${event}">${first.title}</a></h3><p>[${first.source}] followed ${age(at)} ${followAction(
                    event,
                    true,
                    '/following',
                  )}</p><ul>${fresh.map(report)}</ul></div>`,
              )}</div>`,
      }),
    );
  });
}
