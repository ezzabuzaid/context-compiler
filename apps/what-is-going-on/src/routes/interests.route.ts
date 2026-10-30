import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { z } from 'zod';

import events from '../events.ts';
import ranking, { type Ranked } from '../ranking.ts';
import settings from '../settings.ts';
import { controlsSchema } from '../views/controls.ts';
import { layout } from '../views/layout.ts';
import { age } from '../views/line.ts';
import { markup } from '../views/markup.ts';

export default function (router: Hono) {
  router.get(
    '/interests',
    validate((payload) => ({
      name: { select: payload.query.name, against: z.string().default('') },
      sentence: {
        select: payload.query.sentence,
        against: z.string().default(''),
      },
    })),
    async (c) => {
      const draft = c.var.input;
      const answers = settings.answers(draft.name);
      // The draft's best 20 of the last 30 days, as its column would rank them.
      const found: Ranked =
        draft.name.trim() === ''
          ? { answered: true, lines: [] }
          : await ranking.rank(
              { name: draft.name.trim(), sentence: draft.sentence.trim() },
              events.lines({ hours: 720 }),
              { signal: c.req.raw.signal },
            );
      const answer = (report: string, verdict: 'yes' | 'no') =>
        markup`<button formmethod="post" formaction="/interests/answers?${new URLSearchParams({ report, verdict }).toString()}">${
          answers.get(report) === verdict
            ? markup`<b>[${verdict}]</b>`
            : `[${verdict}]`
        }</button>`;
      return c.html(
        await layout({
          title: 'Interests - What is going on',
          signal: c.req.raw.signal,
          hours: controlsSchema.hours.parse(undefined),
          main: markup`<div class="about"><h3>Interests</h3><ul>${settings
            .interests()
            .map(
              ({ name, sentence }) =>
                markup`<li><a href="/interest/${encodeURIComponent(name)}">${name}</a> ${sentence}. <form class="act" method="post" action="/interest/${encodeURIComponent(name)}/delete"><button>[delete]</button></form></li>`,
            )}</ul><h3>New interest</h3><form class="draft" method="post" action="/interests"><p><label for="interest-name">Name</label><br><input id="interest-name" name="name" type="text" required value="${draft.name}"></p><p><label for="interest-sentence">Sentence</label><br><textarea id="interest-sentence" name="sentence" rows="2">${draft.sentence}</textarea></p><p><button formmethod="get" formaction="/interests" formnovalidate>Show matches</button></p><p>Matches from the last 30 days; mark each [yes] or [no]:</p>${
            found.answered
              ? markup`<ul>${found.lines
                  .slice(0, 20)
                  .map(
                    ({ head }) =>
                      markup`<li><a href="${head.url}">${head.title}</a> [${head.source}] ${age(head.published_at)} ${answer(head.id, 'yes')} ${answer(head.id, 'no')}</li>`,
                  )}</ul>`
              : markup`<p>The decision model did not answer.</p>`
          }<p><button type="submit">Add</button></p></form></div>`,
        }),
      );
    },
  );

  router.post(
    '/interests',
    validate((payload) => ({
      name: { select: payload.body.name, against: z.string().trim().min(1) },
      sentence: { select: payload.body.sentence, against: z.string().trim() },
    })),
    (c) => {
      settings.addInterest(c.var.input);
      return c.redirect('/', 303);
    },
  );

  // [delete]: the interest and its answers go.
  router.post(
    '/interest/:name/delete',
    validate((payload) => ({
      name: { select: payload.params.name, against: z.string().min(1) },
    })),
    (c) => {
      settings.deleteInterest(c.var.input.name);
      return c.redirect('/interests', 303);
    },
  );

  // [yes] or [no] about a match of the draft, stored under its name.
  router.post(
    '/interests/answers',
    validate((payload) => ({
      report: { select: payload.query.report, against: z.string().min(1) },
      verdict: {
        select: payload.query.verdict,
        against: z.enum(['yes', 'no']),
      },
      name: { select: payload.body.name, against: z.string().trim().min(1) },
      sentence: { select: payload.body.sentence, against: z.string() },
    })),
    (c) => {
      const { report, verdict, ...draft } = c.var.input;
      settings.answer(draft.name, report, verdict);
      // The draft travels in the query, so the page comes back to it.
      return c.redirect(`/interests?${new URLSearchParams(draft)}`, 303);
    },
  );
}
