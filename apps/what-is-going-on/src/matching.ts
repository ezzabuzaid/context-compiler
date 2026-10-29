import type { Line, Report } from './events.ts';
import settings, { type Interest } from './settings.ts';

// An interest's keywords at the start of a word in the report's title or
// lead, ignoring case, so "protein" matches "proteins" and "LFM" "LFM3". No
// learned filter yet (#3195).
export function matches(keywords: readonly string[], report: Report) {
  const text = `${report.title}\n${report.lead}`;
  return keywords.some((keyword) =>
    new RegExp(`(?<!\\w)${RegExp.escape(keyword)}`, 'iu').test(text),
  );
}

// An interest's lines: its keywords match the lab report, and the user did
// not answer that the report is not this interest.
export function interestLines(interest: Interest, lines: readonly Line[]) {
  const answers = settings.answers(interest.name);
  return lines.filter(
    ({ head }) =>
      matches(interest.keywords, head) && answers.get(head.id) !== 'no',
  );
}

// The lines that no interest shows.
export function unmatched(
  interests: readonly Interest[],
  lines: readonly Line[],
) {
  const shown = new Set(
    interests.flatMap((interest) => interestLines(interest, lines)),
  );
  return lines.filter((line) => !shown.has(line));
}
