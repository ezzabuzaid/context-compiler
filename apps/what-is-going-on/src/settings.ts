import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Declaration } from '@zukhruf/sqlite-drift';
import { z } from 'zod';

import directory from './directory.ts';
import type { Source } from './sources.ts';

// What the user taught the reader. A pipeline run cannot rebuild it, so a
// changed declaration keeps the rows.
const declaration = new Declaration(
  [
    `CREATE TABLE interest (
      name TEXT PRIMARY KEY,
      sentence TEXT NOT NULL,
      keywords TEXT NOT NULL CHECK (json_valid(keywords)),
      created_at INTEGER NOT NULL
    ) STRICT`,
    // An answer about one report under one interest: [x] on a line, or
    // [yes] and [no] while the interest is a draft, before it exists.
    `CREATE TABLE answer (
      interest TEXT NOT NULL,
      report TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('yes', 'no')),
      answered_at INTEGER NOT NULL,
      PRIMARY KEY (interest, report)
    ) STRICT`,
    // A site the user added on the Sources page, and how it is read.
    `CREATE TABLE site (
      site TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('lab', 'outlet')),
      feed TEXT,
      posts TEXT NOT NULL,
      added_at INTEGER NOT NULL
    ) STRICT`,
    `CREATE TABLE follow (
      event INTEGER PRIMARY KEY,
      followed_at INTEGER NOT NULL
    ) STRICT`,
  ],
  { rows: 'keep' },
);

const db = new DatabaseSync(join(directory, 'settings.sqlite'), {
  timeout: 5_000,
});
declaration.apply(db);

export type Interest = {
  readonly name: string;
  readonly sentence: string;
  readonly keywords: readonly string[];
};

const interestSchema = z.object({
  name: z.string(),
  sentence: z.string(),
  keywords: z
    .string()
    .transform((text) => z.array(z.string()).parse(JSON.parse(text))),
});

const siteSchema = z.object({
  site: z.string(),
  name: z.string(),
  kind: z.enum(['lab', 'outlet']),
  feed: z.string().nullable(),
  posts: z.string(),
});

export default {
  sites: (): Source[] =>
    db
      .prepare(
        'SELECT site, name, kind, feed, posts FROM site ORDER BY added_at',
      )
      .all()
      .map((row) => siteSchema.parse(row)),
  // False when the site was added before.
  addSite: (source: Source) =>
    db
      .prepare(
        `INSERT INTO site (site, name, kind, feed, posts, added_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (site) DO NOTHING`,
      )
      .run(
        source.site,
        source.name,
        source.kind,
        source.feed,
        source.posts,
        Date.now(),
      ).changes > 0,
  interests: (): Interest[] =>
    db
      .prepare(
        'SELECT name, sentence, keywords FROM interest ORDER BY created_at',
      )
      .all()
      .map((row) => interestSchema.parse(row)),
  addInterest: (interest: Interest) => {
    db.prepare(
      'INSERT INTO interest (name, sentence, keywords, created_at) VALUES (?, ?, ?, ?)',
    ).run(
      interest.name,
      interest.sentence,
      JSON.stringify(interest.keywords),
      Date.now(),
    );
  },
  // Each report's answer under one interest.
  answers: (interest: string) =>
    new Map(
      db
        .prepare('SELECT report, verdict FROM answer WHERE interest = ?')
        .all(interest)
        .map((row) => [
          z.string().parse(row.report),
          z.enum(['yes', 'no']).parse(row.verdict),
        ]),
    ),
  answer: (interest: string, report: string, verdict: 'yes' | 'no') => {
    db.prepare(
      `INSERT INTO answer (interest, report, verdict, answered_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (interest, report) DO UPDATE SET verdict = excluded.verdict, answered_at = excluded.answered_at`,
    ).run(interest, report, verdict, Date.now());
  },
  follows: () =>
    new Map(
      db
        .prepare('SELECT event, followed_at FROM follow')
        .all()
        .map((row) => [
          z.number().parse(row.event),
          z.number().parse(row.followed_at),
        ]),
    ),
  follow: (event: number) => {
    db.prepare(
      'INSERT INTO follow (event, followed_at) VALUES (?, ?) ON CONFLICT (event) DO NOTHING',
    ).run(event, Date.now());
  },
  unfollow: (event: number) => {
    db.prepare('DELETE FROM follow WHERE event = ?').run(event);
  },
};
