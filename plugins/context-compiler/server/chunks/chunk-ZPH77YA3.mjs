import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// ../elt/node_modules/@zukhruf/sqlite-snapshot/dist/missing-columns-error.js
var MissingColumnsError = class extends Error {
  path;
  missing;
  constructor(path, missing) {
    super(`The database at ${JSON.stringify(path)} lacks the columns ${missing.join(", ")}: its owner changed its layout. Update the reader to the new layout.`);
    this.name = "MissingColumnsError";
    this.path = path;
    this.missing = missing;
  }
};

// ../elt/node_modules/@zukhruf/sqlite-snapshot/dist/snapshot.js
import { DatabaseSync } from "node:sqlite";

// ../elt/node_modules/@zukhruf/sqlite-snapshot/dist/unavailable-error.js
var UnavailableError = class extends Error {
  path;
  constructor(path, cause) {
    super(`The database at ${JSON.stringify(path)} cannot be opened: the file is missing, or this process has no access to it. Give the process access, or check the path.`, { cause });
    this.name = "UnavailableError";
    this.path = path;
  }
};

// ../elt/node_modules/@zukhruf/sqlite-snapshot/dist/snapshot.js
function open(path) {
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch (cause) {
    if (cause instanceof Error && "errcode" in cause && // SQLite's CANTOPEN (14). A missing or denied file fails the open()
    // syscall, and SQLite reports that as CANTOPEN, a privacy denial too.
    // SQLite gives AUTH only for an authorizer, and this private connection
    // has none. Any other failure is not one that access can fix.
    cause.errcode === 14)
      throw new UnavailableError(path, cause);
    throw cause;
  }
}
var Snapshot = class {
  path;
  #database;
  constructor(path) {
    this.path = path;
    this.#database = open(path);
    try {
      this.#database.exec("BEGIN");
      this.#database.prepare("SELECT 1 FROM sqlite_schema LIMIT 1").get();
    } catch (cause) {
      this.#database.close();
      throw cause;
    }
  }
  // Refuses a layout without these columns, and closes the database: the
  // check a reader makes while it opens the snapshot.
  requireColumns(columns) {
    const missing = this.missingColumns(columns);
    if (missing.length === 0)
      return;
    this[Symbol.dispose]();
    throw new MissingColumnsError(this.path, missing);
  }
  // The columns, as table.column, that this layout lacks. A reader whose
  // reads use different tables checks each read with it and keeps the
  // snapshot open for the others.
  missingColumns(columns) {
    return Object.entries(columns).flatMap(([table, names]) => {
      const present = new Set(this.all("SELECT name FROM pragma_table_info(?)", table).map((column) => column.name));
      return names.filter((name) => !present.has(name)).map((name) => `${table}.${name}`);
    });
  }
  all(sql, ...parameters) {
    return this.#database.prepare(sql).all(...parameters);
  }
  // Rows one at a time, for a table too large to hold whole.
  iterate(sql, ...parameters) {
    return this.#database.prepare(sql).iterate(...parameters);
  }
  [Symbol.dispose]() {
    if (!this.#database.isOpen)
      return;
    if (this.#database.isTransaction)
      this.#database.exec("COMMIT");
    this.#database.close();
  }
};

// ../elt/node_modules/@zukhruf/sqlite-data-version/dist/followed-database.js
import { statSync } from "node:fs";
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

// ../elt/node_modules/@zukhruf/sqlite-data-version/dist/unavailable-error.js
var UnavailableError2 = class extends Error {
  path;
  constructor(path, cause) {
    super(`The database at ${JSON.stringify(path)} cannot be opened: the file is missing, or this process has no access to it. Give the process access, or check the path.`, { cause });
    this.name = "UnavailableError";
    this.path = path;
  }
};

// ../elt/node_modules/@zukhruf/sqlite-data-version/dist/followed-database.js
function open2(path) {
  try {
    return new DatabaseSync2(path, { readOnly: true });
  } catch (cause) {
    if (cause instanceof Error && "errcode" in cause && // SQLite's CANTOPEN (14). A missing or denied file fails the open()
    // syscall, and SQLite reports that as CANTOPEN, a privacy denial too.
    // SQLite gives AUTH only for an authorizer, and this private connection
    // has none. Any other failure is not one that access can fix.
    cause.errcode === 14)
      throw new UnavailableError2(path, cause);
    throw cause;
  }
}
function identify(path) {
  try {
    const stats = statSync(path, { bigint: true, throwIfNoEntry: false });
    return stats === void 0 ? void 0 : `${stats.dev}:${stats.ino}`;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "EACCES")
      return void 0;
    throw cause;
  }
}
var OpenFile = class {
  identity;
  #database;
  #version;
  constructor(path) {
    this.identity = identify(path);
    this.#database = open2(path);
    this.#version = this.#database.prepare("PRAGMA data_version");
  }
  get observation() {
    return `${this.identity}|${String(this.#version.get().data_version)}`;
  }
  [Symbol.dispose]() {
    this.#database.close();
  }
};
var FollowedDatabase = class {
  #path;
  #file;
  constructor(path) {
    this.#path = path;
    this.#file = new OpenFile(path);
  }
  // The identity of the held file and its data version. A path this process
  // cannot see keeps the old connection: the owner may be about to create the
  // file again, and the open connection still reads.
  observe() {
    const identity = identify(this.#path);
    if (identity !== void 0 && identity !== this.#file.identity) {
      const file = new OpenFile(this.#path);
      this.#file[Symbol.dispose]();
      this.#file = file;
    }
    return this.#file.observation;
  }
  [Symbol.dispose]() {
    this.#file[Symbol.dispose]();
  }
};

// ../elt/node_modules/@zukhruf/sqlite-data-version/dist/data-version.js
var DataVersion = class {
  #database;
  #seen;
  #current = 0;
  constructor(path) {
    this.#database = new FollowedDatabase(path);
    this.#seen = this.#database.observe();
  }
  get current() {
    const observed = this.#database.observe();
    if (observed !== this.#seen) {
      this.#seen = observed;
      this.#current += 1;
    }
    return this.#current;
  }
  [Symbol.dispose]() {
    this.#database[Symbol.dispose]();
  }
};

// ../elt/node_modules/@zukhruf/sqlite-data-version/dist/last-write.js
import { statSync as statSync2 } from "node:fs";
var unreadable = /* @__PURE__ */ new Set(["ENOENT", "EACCES"]);
function lastWrite(path) {
  try {
    const file = statSync2(path).mtimeMs;
    const wal = statSync2(`${path}-wal`, { throwIfNoEntry: false });
    return new Date(wal !== void 0 && wal.size > 0 ? Math.max(file, wal.mtimeMs) : file);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && unreadable.has(String(cause.code)))
      throw new UnavailableError2(path, cause);
    throw cause;
  }
}

// ../elt/packages/sdks/macos/app-database/dist/unavailable.js
function readOrUnavailable(path, unavailable, read) {
  try {
    return read();
  } catch (error) {
    if (error instanceof UnavailableError2)
      throw new unavailable(path, error);
    throw error;
  }
}

// ../elt/packages/sdks/macos/app-database/dist/app-database-version.js
var AppDatabaseVersion = class {
  #path;
  #unavailable;
  #version;
  constructor(path, unavailable) {
    this.#path = path;
    this.#unavailable = unavailable;
    this.#version = readOrUnavailable(path, unavailable, () => new DataVersion(path));
  }
  get current() {
    return readOrUnavailable(this.#path, this.#unavailable, () => this.#version.current);
  }
  [Symbol.dispose]() {
    this.#version[Symbol.dispose]();
  }
};

// ../elt/packages/sdks/macos/app-database/dist/app-database.js
var AppDatabase = class {
  #errors;
  constructor(errors) {
    this.#errors = errors;
  }
  snapshot(path, columns) {
    try {
      const snapshot = new Snapshot(path);
      if (columns)
        snapshot.requireColumns(columns);
      return snapshot;
    } catch (error) {
      if (error instanceof UnavailableError)
        throw new this.#errors.unavailable(path, error);
      throw error;
    }
  }
  version(path) {
    return new AppDatabaseVersion(path, this.#errors.unavailable);
  }
  lastWrite(path) {
    return readOrUnavailable(path, this.#errors.unavailable, () => lastWrite(path));
  }
};

export {
  MissingColumnsError,
  AppDatabase
};
