import type { Span } from '@workspace/quote-grounding';

const overlap = (a: Span, b: Span) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

// Two spans state the same thing when they share at least half of the
// shorter one, so a quote of a sentence without its heading, or with it,
// still states the same thing.
export const same = (a: Span, b: Span) =>
  overlap(a, b) * 2 >= Math.min(a.end - a.start, b.end - b.start);
