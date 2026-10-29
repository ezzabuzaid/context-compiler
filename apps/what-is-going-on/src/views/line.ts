import { z } from 'zod';

import type { Line } from '../events.ts';
import { type Html, markup } from './markup.ts';

// An age as brutalist.report shows it: minutes, hours under a day, then
// days. A report without a date has none.
export function age(at: number | null) {
  if (at === null) return '[no date]';
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 60) return `[${minutes}m]`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `[${hours}h]` : `[${Math.round(hours / 24)}d]`;
}

// The page an action returns to: a path of this site.
export const backSchema = z.string().regex(/^\/(?!\/)/);

// A POST that a link-styled button sends, then the page at back again.
export function action(
  path: string,
  label: string,
  back: string,
  fields: Record<string, string> = {},
  attributes: Html | null = null,
) {
  return markup`<form class="act" method="post" action="${path}">${Object.entries(
    fields,
  ).map(
    ([name, value]) =>
      markup`<input type="hidden" name="${name}" value="${value}">`,
  )}<input type="hidden" name="back" value="${back}"><button${attributes === null ? '' : markup` ${attributes}`}>${label}</button></form>`;
}

export const followAction = (event: number, followed: boolean, back: string) =>
  followed
    ? action(`/event/${event}/unfollow`, '[unfollow]', back)
    : action(`/event/${event}/follow`, '[follow]', back);

// One event per line: the lab's report, its lab, its age, the other reports,
// the reports new since following, follow, and on an interest "not this
// interest".
export function line(
  { event, head, folded, reports }: Line,
  options: {
    readonly follows: ReadonlyMap<number, number>;
    readonly back: string;
    readonly interest?: string;
  },
) {
  const followedAt = options.follows.get(event);
  const fresh =
    followedAt === undefined
      ? 0
      : reports.filter(({ stored_at }) => stored_at > followedAt).length;
  return markup`<li><a href="${head.url}">${head.title}</a> [${head.source}] ${age(head.published_at)}${
    folded.length > 0 &&
    markup` <a href="/event/${event}">[+${folded.length}]</a>`
  }${fresh > 0 && markup` <a href="/event/${event}"><b>[${fresh} new]</b></a>`} ${followAction(
    event,
    followedAt !== undefined,
    options.back,
  )}${
    options.interest !== undefined &&
    markup` ${action(
      `/interest/${encodeURIComponent(options.interest)}/answers`,
      '[x]',
      options.back,
      { report: head.id, verdict: 'no' },
      markup`aria-label="Not ${options.interest}"`,
    )}`
  }</li>`;
}
