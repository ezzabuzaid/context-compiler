import { offerResources, programResource, storedPrograms } from './programs.ts';
import store from './store.ts';
import { items } from './verdicts.ts';

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

// Writes an event for each change since the log last reported, change data
// capture by comparison with what the log holds: a program that the
// warehouse holds for the first time, a program whose valued offers changed,
// with the offers that the log reported before, and a program that a query's
// criteria come to match or no longer match. As the console alert decides, a
// program that leaves the warehouse has not ended, so no event says so, and
// an answer that only quotes other words is no change.
export function recordEvents(): void {
  const programs = storedPrograms();
  store.transaction(() => {
    for (const program of programs) {
      const offers = offerResources(program);
      const known = store.program(program.articleUrl);
      if (known === undefined) {
        const id = store.addProgram(program.articleUrl, program.valued, offers);
        store.append({
          type: 'program.added',
          query: null,
          data: programResource(id, program),
          previous: null,
        });
      } else if (!same(known.valued, program.valued)) {
        store.changeProgram(program.articleUrl, program.valued, offers);
        store.append({
          type: 'program.changed',
          query: null,
          data: programResource(known.id, program),
          previous: { offers: known.offers },
        });
      }
    }
    for (const query of store.queries()) {
      const matched = store.matches(query.id);
      for (const item of items(query)) {
        if (item.matches && !matched.has(item.program.id)) {
          store.match(query.id, item.program.id);
          store.append({
            type: 'item.matched',
            query: query.id,
            data: item,
            previous: null,
          });
        } else if (!item.matches && matched.has(item.program.id)) {
          store.unmatch(query.id, item.program.id);
          store.append({
            type: 'item.unmatched',
            query: query.id,
            data: item,
            previous: null,
          });
        }
      }
    }
  });
}
