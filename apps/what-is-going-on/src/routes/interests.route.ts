import { validate } from '@sdk-it/hono/runtime';
import type { Hono } from 'hono';
import { z } from 'zod';

import events from '../events.ts';
import { matches } from '../matching.ts';
import settings from '../settings.ts';
import { controlsSchema } from '../views/controls.ts';
import { layout } from '../views/layout.ts';
import { age } from '../views/line.ts';
import { markup } from '../views/markup.ts';

const keywordsSchema = z.string().transform((text) =>
  text
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean),
);

export default function (router: Hono) {
  router.get(
    '/interests',
    validate((payload) => ({
      name: { select: payload.query.name, against: z.string().default('') },
      sentence: {
        select: payload.query.sentence,
        against: z.string().default(''),
      },
      keywords: {
        select: payload.query.keywords,
        against: z.string().default(''),
      },
    })),
    (c) => {
      const draft = c.var.input;
      const keywords = keywordsSchema.parse(draft.keywords);
      const answers = settings.answers(draft.name);
      const found =
        keywords.length === 0
          ? []
          : events
              .lines({ hours: 720 })
              .filter(({ head }) => matches(keywords, head))
              .toSorted((a, b) => b.head.published_at - a.head.published_at);
      const answer = (report: string, verdict: 'yes' | 'no') =>
        markup`<button formmethod="post" formaction="/interests/answers?${new URLSearchParams({ report, verdict }).toString()}">${
          answers.get(report) === verdict
            ? markup`<b>[${verdict}]</b>`
            : `[${verdict}]`
        }</button>`;
      return c.html(
        layout({
          title: 'Interests - What is going on',
          hours: controlsSchema.hours.parse(undefined),
          main: markup`<div class="about"><h3>Interests</h3><ul>${settings
            .interests()
            .map(
              ({ name, sentence, keywords }) =>
                markup`<li><a href="/interest/${encodeURIComponent(name)}">${name}</a> ${sentence}. [${keywords.join(', ')}]</li>`,
            )}</ul><h3>New interest</h3><form class="draft" method="post" action="/interests"><p><label for="interest-name">Name</label><br><input id="interest-name" name="name" type="text" required value="${draft.name}"></p><p><label for="interest-sentence">Sentence</label><br><textarea id="interest-sentence" name="sentence" rows="2">${draft.sentence}</textarea></p><p><label for="interest-keywords">Keywords</label><br><input id="interest-keywords" name="keywords" type="text" value="${draft.keywords}"></p><p><button formmethod="get" formaction="/interests" formnovalidate>Show matches</button></p><p>Matches from the last 30 days; mark each [yes] or [no]:</p><ul>${found.map(
            ({ head }) =>
              markup`<li><a href="${head.url}">${head.title}</a> [${head.source}] ${age(head.published_at)} ${answer(head.id, 'yes')} ${answer(head.id, 'no')}</li>`,
          )}</ul><p><button type="submit">Add</button></p></form></div>`,
        }),
      );
    },
  );

  router.post(
    '/interests',
    validate((payload) => ({
      name: { select: payload.body.name, against: z.string().trim().min(1) },
      sentence: { select: payload.body.sentence, against: z.string().trim() },
      keywords: {
        select: payload.body.keywords,
        against: keywordsSchema.pipe(z.array(z.string()).min(1)),
      },
    })),
    (c) => {
      settings.addInterest(c.var.input);
      return c.redirect('/', 303);
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
      keywords: { select: payload.body.keywords, against: z.string() },
    })),
    (c) => {
      const { report, verdict, ...draft } = c.var.input;
      settings.answer(draft.name, report, verdict);
      // The draft travels in the query, so the page comes back to it.
      return c.redirect(`/interests?${new URLSearchParams(draft)}`, 303);
    },
  );
}
