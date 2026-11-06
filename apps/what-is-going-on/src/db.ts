import { join } from 'node:path';

import { open } from '@zukhruf/sqlite-open';

import directory from './directory.ts';

// Opened read-write so a first start creates the file, which readOnly cannot;
// query_only then refuses every write on this connection. The pipeline's
// Reports dataset is the file's only writer.
const db = open(join(directory, 'app.sqlite'));
db.exec('PRAGMA query_only = ON');

export default db;
