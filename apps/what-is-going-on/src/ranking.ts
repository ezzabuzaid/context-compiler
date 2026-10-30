import { Collection, UnknownDocumentError } from '@zukhruf/embeddings';
import { Profile, SimilarityScorer } from '@zukhruf/relevance-filtering';
import { embed } from 'ai';

import db from './db.ts';
import model from './embedding-model.ts';
import events, { type Line, type Report } from './events.ts';
import settings, { type Interest } from './settings.ts';

// Spaces and hyphens between words, so "fine tuning" and "Fine-Tuning" are
// the same words, as a search engine's tokenizer splits words at hyphens.
const between = String.raw`[\s\-‐-―]+`;

// A keyword at the start of a word, in any case, so "protein" matches
// "proteins" and "LFM" "LFM3".
const keyword = (text: string) =>
  new RegExp(
    `(?<!\\w)${text
      .split(new RegExp(between, 'u'))
      .map((word) => RegExp.escape(word))
      .join(between)}`,
    'iu',
  );

// The date the vectors hold for a report: the event detector stores the
// start of its UTC publish day.
function publishDay(report: Report) {
  const at = new Date(report.published_at ?? report.stored_at);
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

const text = (report: Report) => `${report.title} ${report.lead}`;

// Ranks the lines for each interest with @zukhruf/relevance-filtering
// (#3195): the interest's sentence by embedding similarity, its keywords as
// evidence, and the user's yes and no answers. The best come first; a report
// the user answered no for is never in that interest.
class Ranking {
  // The query vector of each sentence, made once.
  readonly #queries = new Map<string, Promise<number[]>>();

  async rank(interest: Interest, lines: readonly Line[]): Promise<Line[]> {
    const vectors = new Collection({ database: db, model });
    // A headline-only report has no vector (event-grouping ADR 0003).
    const stored = (id: string) => {
      try {
        vectors.fetch([id]);
        return true;
      } catch (error) {
        if (error instanceof UnknownDocumentError) return false;
        throw error;
      }
    };
    const ranked = lines.filter(({ head }) => stored(head.id));
    const [first, ...rest] = ranked.map(({ head }) => ({
      id: head.id,
      publishedAt: publishDay(head),
      text: text(head),
    }));
    if (first === undefined) return [];
    const answers = settings.answers(interest.name);
    const answered = (verdict: 'yes' | 'no') =>
      [...answers]
        .filter(([id, given]) => given === verdict && stored(id))
        .map(([id]) => id);
    const scorer = new SimilarityScorer({
      vectors,
      embedDescription: (description) => this.#query(description),
      taughtText: (id) => {
        const report = events.report(id);
        return report === undefined ? '' : text(report);
      },
    });
    const profile = new Profile({
      name: interest.name,
      description: interest.sentence || interest.name,
      keywords: interest.keywords.map(keyword),
      relevant: answered('yes'),
      notRelevant: answered('no'),
    });
    const scores = await scorer.score(profile, [first, ...rest]);
    const byId = new Map(ranked.map((line) => [line.head.id, line]));
    return scores.ranked().flatMap((id) => {
      const line = byId.get(id);
      return line === undefined || answers.get(id) === 'no' ? [] : [line];
    });
  }

  // The lines that no interest shows among its best limit.
  async unmatched(
    interests: readonly Interest[],
    lines: readonly Line[],
    limit: number,
  ) {
    const shown = new Set(
      (
        await Promise.all(
          interests.map(async (interest) =>
            (await this.rank(interest, lines)).slice(0, limit),
          ),
        )
      ).flat(),
    );
    return lines.filter((line) => !shown.has(line));
  }

  #query(description: string) {
    let vector = this.#queries.get(description);
    if (vector === undefined) {
      vector = embed({
        model,
        value: `task: search result | query: ${description}`,
      }).then(({ embedding }) => embedding);
      vector.catch(() => this.#queries.delete(description));
      this.#queries.set(description, vector);
    }
    return vector;
  }
}

export default new Ranking();
