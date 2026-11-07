import { Declaration } from '@zukhruf/sqlite-drift';

export default new Declaration(
  [
    `CREATE TABLE changes (
    seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
    source TEXT NOT NULL, table_name TEXT NOT NULL, key TEXT,
    event TEXT NOT NULL, received_at TEXT NOT NULL,
    decision TEXT, evidence TEXT, failure TEXT, duration_ms REAL)`,
    `CREATE INDEX changes_entity ON changes(source,table_name,seq DESC)`,
    `CREATE TABLE turns (id TEXT PRIMARY KEY REFERENCES changes(id), stream_id TEXT NOT NULL UNIQUE)`,
    `CREATE TABLE notifications (
    id TEXT PRIMARY KEY REFERENCES changes(id), message TEXT NOT NULL,
    evidence TEXT NOT NULL, created_at TEXT NOT NULL)`,
  ],
  { rows: 'replace' },
);
