import { type Candidate, candidates, itemResource } from './items.ts';
import store from './store.ts';

// The fields of a page that the model has read, by name: what makes an item
// change.
const read = ({ fields }: Candidate) =>
  Object.fromEntries(
    Object.entries(fields).flatMap(([name, result]) =>
      result.state === 'read' ? [[name, result.value]] : [],
    ),
  );

// Writes an event for each change since the log last reported, change data
// capture by comparison with what the log holds, as Exa's Websets report
// items: item.created when a page comes to meet every criterion,
// item.updated when the fields read from an item change, the first reading
// included, with the fields before it, and item.removed when a page no
// longer meets every criterion. Changes between two checks come as one
// event, so fields read by then come with item.created.
export function recordEvents(): void {
  const collections = store
    .crawled()
    .map((collection) => [collection, candidates(collection)] as const);
  store.transaction(() => {
    for (const [{ id: collection }, pages] of collections) {
      for (const page of pages) {
        const known = store.item(collection, page.url);
        const fields = read(page);
        if (page.matches && (known === undefined || !known.matches)) {
          const id = store.saveItem(collection, page.url, {
            matches: true,
            fields,
          });
          store.append({
            collection,
            type: 'item.created',
            data: itemResource(id, page),
            previous: null,
          });
        } else if (
          page.matches &&
          known !== undefined &&
          JSON.stringify(known.fields) !== JSON.stringify(fields)
        ) {
          store.saveItem(collection, page.url, { matches: true, fields });
          store.append({
            collection,
            type: 'item.updated',
            data: itemResource(known.id, page),
            previous: { fields: known.fields },
          });
        } else if (!page.matches && known?.matches === true) {
          store.saveItem(collection, page.url, {
            matches: false,
            fields: known.fields,
          });
          store.append({
            collection,
            type: 'item.removed',
            data: itemResource(known.id, page),
            previous: null,
          });
        }
      }
    }
  });
}
