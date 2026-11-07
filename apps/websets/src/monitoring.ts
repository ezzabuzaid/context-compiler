import { z } from 'zod';

import { DatasetCheck } from './checks/dataset-check.ts';
import { PageCheck } from './checks/page-check.ts';
import { SearchCheck } from './checks/search-check.ts';
import store from './store.ts';

const jobSchema = z.object({ monitor: z.string() });

// One run of a monitor, sent when it is made or on its cron. A monitor that
// was deleted after its job was sent has no run.
export async function runMonitor(data: unknown, signal: AbortSignal) {
  const { monitor: id } = jobSchema.parse(data);
  const monitor = store.monitor(id);
  if (monitor === undefined) {
    return;
  }
  const { target } = monitor;
  if ('page' in target) {
    await new PageCheck(id, target.page).run(signal);
  } else if ('search' in target) {
    await new SearchCheck(id, target.search).run(signal);
  } else {
    // The API keeps a monitor of a dataset only while the dataset is kept
    // and only for a dataset with a search.
    const dataset = store.dataset(target.dataset)!;
    await new DatasetCheck(id, dataset, dataset.search!).run(signal);
  }
}
