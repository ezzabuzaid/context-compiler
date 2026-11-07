import { join } from 'node:path';

import { SqliteJobQueue } from '@zukhruf/sqlite-queue';

import directory from './directory.ts';

// The searches of the datasets, sent when a dataset is made and on
// the cron of its monitor: pg-boss's queue on a SQLite file, so a search
// that a stop interrupted runs after the next start.
export default new SqliteJobQueue({ path: join(directory, 'jobs.sqlite') });

// The queue of the searches; a job's data names its dataset.
export const searches = 'search';
