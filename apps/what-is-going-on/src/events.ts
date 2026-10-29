import { z } from 'zod';

import db from './db.ts';

const reportSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  lead: z.string(),
  source: z.string(),
  kind: z.enum(['lab', 'outlet']),
  // null when neither the page nor its feed gives a date.
  published_at: z.number().nullable(),
  stored_at: z.number(),
  event: z.number(),
});
export type Report = z.infer<typeof reportSchema>;

// One line of a page: a lab report, and the other reports of its event folded
// under it. Two reports of one lab never fold together, so each heads its
// own line. reports holds every report of the event.
export type Line = {
  readonly event: number;
  readonly head: Report;
  readonly folded: readonly Report[];
  readonly reports: readonly Report[];
};

// The report table appears with the pipeline's first refresh.
const loaded = () =>
  db.prepare(`SELECT 1 FROM sqlite_schema WHERE name = 'report'`).get() !==
  undefined;

function reports(sql: string, ...parameters: (string | number)[]) {
  return loaded()
    ? db
        .prepare(sql)
        .all(...parameters)
        .map((row) => reportSchema.parse(row))
    : [];
}

// When a report counts for a time window: its date, or, without one, when the
// app first stored it.
const when = (report: Report) => report.published_at ?? report.stored_at;

// Dated reports by date, then the undated ones by when the app stored them.
export function oldestFirst(a: Report, b: Report) {
  return (
    Number(a.published_at === null) - Number(b.published_at === null) ||
    when(a) - when(b)
  );
}

// Dated reports newest first, then the undated ones.
export function newestFirst(a: Report, b: Report) {
  return (
    Number(a.published_at === null) - Number(b.published_at === null) ||
    when(b) - when(a)
  );
}

// The lines of one event: its earliest lab report heads it, the other
// reports fold under it, except the same lab's other reports, which head
// lines of their own. An event with no lab report has no line.
function eventLines(members: readonly Report[]): Line[] {
  const sorted = members.toSorted(oldestFirst);
  const head = sorted.find(({ kind }) => kind === 'lab');
  if (head === undefined) return [];
  const own = sorted.filter(
    (report) =>
      report !== head && report.kind === 'lab' && report.source === head.source,
  );
  return [
    {
      event: head.event,
      head,
      folded: sorted.filter(
        (report) => report !== head && !own.includes(report),
      ),
      reports: sorted,
    },
    ...own.map((report) => ({
      event: report.event,
      head: report,
      folded: [],
      reports: sorted,
    })),
  ];
}

export default {
  // The lines whose lab report was published, or, undated, first stored in
  // the last hours; newest first.
  lines: ({ hours }: { hours: number }): Line[] => {
    const since = Date.now() - hours * 3_600_000;
    const members = reports(
      `SELECT * FROM report WHERE event IN (
        SELECT event FROM report
        WHERE kind = 'lab' AND coalesce(published_at, stored_at) >= ?
      )`,
      since,
    );
    return [...Map.groupBy(members, ({ event }) => event).values()]
      .flatMap(eventLines)
      .filter(({ head }) => when(head) >= since)
      .toSorted((a, b) => newestFirst(a.head, b.head));
  },
  // When the newest report was stored; null before the first refresh.
  updatedAt: (): Date | null => {
    if (!loaded()) return null;
    const { at } =
      db.prepare('SELECT max(stored_at) AS at FROM report').get() ?? {};
    return typeof at === 'number' ? new Date(at) : null;
  },
  // Each source's newest dated report, by source name.
  newest: (): Map<string, number> =>
    new Map(
      loaded()
        ? db
            .prepare(
              'SELECT source, max(published_at) AS at FROM report WHERE published_at IS NOT NULL GROUP BY source',
            )
            .all()
            .map((row) => [
              z.string().parse(row.source),
              z.number().parse(row.at),
            ])
        : [],
    ),
  report: (id: string): Report | undefined =>
    reports('SELECT * FROM report WHERE id = ?', id)[0],
  // Every report of one event, earliest first, the undated ones last.
  event: (id: number): Report[] =>
    reports('SELECT * FROM report WHERE event = ?', id).toSorted(oldestFirst),
};
