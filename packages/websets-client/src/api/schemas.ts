import datasets from './datasets.ts';
import events from './events.ts';
import fetch from './fetch.ts';
import items from './items.ts';
import search_ from './search-.ts';

export default {
  ...datasets,
  ...events,
  ...fetch,
  ...items,
  ...search_,
};
