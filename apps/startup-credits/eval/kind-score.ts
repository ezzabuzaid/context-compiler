import type { Label } from './answer-key.ts';

// How many page kinds a model got right on the test pages it answered, and
// each wrong answer as "labelled → answered".
export function scoreKinds(
  labels: readonly Label[],
  answers: ReadonlyMap<string, string>,
) {
  const answered = labels.flatMap((label) => {
    const answer = answers.get(label.url);
    return label.role === 'test' && answer !== undefined
      ? [{ label, answer }]
      : [];
  });
  const wrong = answered.filter(({ label, answer }) => answer !== label.kind);
  const confusions = new Map<string, number>();
  for (const { label, answer } of wrong) {
    const confusion = `${label.kind} → ${answer}`;
    confusions.set(confusion, (confusions.get(confusion) ?? 0) + 1);
  }
  return {
    pages: answered.length,
    right: answered.length - wrong.length,
    confusions,
  };
}
