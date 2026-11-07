import type { Evidence } from '../../contracts/evidence.ts';

// Four warehouse reads and 6,000 bytes of evidence per turn, keyed by stream.
export class ReadBudget {
  readonly #turns = new Map<string, { count: number; evidence: Evidence[] }>();

  read(streamId: string, query: () => Evidence[]): Evidence[] {
    let budget = this.#turns.get(streamId);
    if (!budget) {
      budget = { count: 0, evidence: [] };
      this.#turns.set(streamId, budget);
    }
    if (++budget.count > 4)
      throw new Error(
        'Read budget exhausted. Decide using the evidence already available.',
      );
    const rows = query();
    if (Buffer.byteLength(JSON.stringify([...budget.evidence, ...rows])) > 6000)
      throw new Error(
        'Retrieved evidence exceeds the context budget. Select fewer rows or columns.',
      );
    budget.evidence.push(...rows);
    return rows;
  }

  evidence(streamId: string): Evidence[] {
    return this.#turns.get(streamId)?.evidence ?? [];
  }

  release(streamId: string): void {
    this.#turns.delete(streamId);
  }
}
