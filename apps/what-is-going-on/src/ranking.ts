import { articleText, score } from './decisions.ts';
import type { Line } from './events.ts';
import settings, { type Interest } from './settings.ts';

// An interest's lines, the best first, or no ranking when the decision model
// did not answer (#3430: no other ranker stands in).
export type Ranked =
  | { readonly answered: true; readonly lines: readonly Line[] }
  | { readonly answered: false };

// Ranks the lines for each interest with @zukhruf/relevance-filtering's
// decision scorer: d1-2B asks if the main subject of each report is the
// interest's sentence (#3383). A report the user answered no for is never in
// that interest.
class Ranking {
  async rank(
    interest: Interest,
    lines: readonly Line[],
    options: { readonly signal: AbortSignal },
  ): Promise<Ranked> {
    const scores = await score(
      interest,
      new Map(
        lines.map(({ head }) => [
          head.id,
          {
            publishedAt: new Date(head.published_at ?? head.stored_at),
            text: articleText(head),
          },
        ]),
      ),
      options,
    );
    if (scores === undefined) return { answered: false };
    const byId = new Map(lines.map((line) => [line.head.id, line]));
    const answers = settings.answers(interest.name);
    return {
      answered: true,
      lines: scores.ranked().flatMap((id) => {
        const line = byId.get(id);
        return line === undefined || answers.get(id) === 'no' ? [] : [line];
      }),
    };
  }

  // The lines that no interest shows among its best limit. An interest whose
  // decision model did not answer shows nothing.
  async unmatched(
    interests: readonly Interest[],
    lines: readonly Line[],
    limit: number,
    options: { readonly signal: AbortSignal },
  ) {
    const shown = new Set(
      (
        await Promise.all(
          interests.map(async (interest) => {
            const ranked = await this.rank(interest, lines, options);
            return ranked.answered ? ranked.lines.slice(0, limit) : [];
          }),
        )
      ).flat(),
    );
    return lines.filter((line) => !shown.has(line));
  }
}

export default new Ranking();
