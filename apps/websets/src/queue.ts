import { join } from 'node:path';

import { SqliteJobQueue } from '@zukhruf/sqlite-queue';

import directory from './directory.ts';

// The searches of the datasets, sent when a dataset is made, and the runs
// of the monitors, sent on their crons: pg-boss's queue on a SQLite file, so
// a job that a stop interrupted runs after the next start.
export default new SqliteJobQueue({ path: join(directory, 'jobs.sqlite') });

// The queue of the searches; a job's data names its dataset.
export const searches = 'search';

// The queue of the monitors' runs; a job's data names its monitor.
export const monitors = 'monitor';
