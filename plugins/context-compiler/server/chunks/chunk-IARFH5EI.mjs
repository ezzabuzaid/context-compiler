import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
import {
  CheckpointStore,
  Connection,
  Copy,
  CopyConfiguration,
  Destination,
  FileContent,
  FileRead,
  Identifiers,
  LocalFiles,
  Pipeline,
  PipelineError,
  StreamStatus,
  SyncHistory,
  Target,
  TargetOwnedError,
  WatchError,
  Writer,
  copyStatus,
  declaredFormat,
  describeTarget,
  isCalendarDate,
  isTimestamp,
  passError,
  passFailureType,
  passStatus,
  readerCatalog,
  recordedFailure,
  reloadMode,
  syncHistoryRelations
} from "./chunk-UZWKSGGL.mjs";
import {
  __callDispose,
  __using
} from "./chunk-ZGXE7NZW.mjs";

// packages/connectors/connector/dist/connector.js
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readdirSync as readdirSync2 } from "node:fs";
import { join as join6 } from "node:path";
import { DatabaseSync as DatabaseSync12 } from "node:sqlite";

// node_modules/is-network-error/index.js
var objectToString = Object.prototype.toString;
var isError = (value) => objectToString.call(value) === "[object Error]";
var errorMessages = /* @__PURE__ */ new Set([
  "network error",
  // Chrome
  "NetworkError when attempting to fetch resource.",
  // Firefox
  "The Internet connection appears to be offline.",
  // Safari 16
  "Network request failed",
  // `cross-fetch`
  "fetch failed",
  // Undici (Node.js)
  "terminated",
  // Undici (Node.js)
  " A network error occurred.",
  // Bun (WebKit)
  "Network connection lost"
  // Cloudflare Workers (fetch)
]);
function isNetworkError(error) {
  const isValid = error && isError(error) && error.name === "TypeError" && typeof error.message === "string";
  if (!isValid) {
    return false;
  }
  const { message: message2, stack } = error;
  if (message2 === "Load failed" || message2.startsWith("Load failed (") && message2.endsWith(")")) {
    return stack === void 0 || "__sentry_captured__" in error;
  }
  if (message2.startsWith("error sending request for url")) {
    return true;
  }
  if (message2 === "Failed to fetch" || message2.startsWith("Failed to fetch (") && message2.endsWith(")")) {
    return true;
  }
  return errorMessages.has(message2);
}

// node_modules/p-retry/index.js
function validateRetries(retries) {
  if (typeof retries === "number") {
    if (retries < 0) {
      throw new TypeError("Expected `retries` to be a non-negative number.");
    }
    if (Number.isNaN(retries)) {
      throw new TypeError("Expected `retries` to be a valid number or Infinity, got NaN.");
    }
    if (Number.isFinite(retries) && !Number.isInteger(retries)) {
      throw new TypeError("Expected `retries` to be a non-negative integer or Infinity.");
    }
  } else if (retries !== void 0) {
    throw new TypeError("Expected `retries` to be a number or Infinity.");
  }
}
function validateNumberOption(name, value, { min = 0, allowInfinity = false } = {}) {
  if (value === void 0) {
    return;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new TypeError(`Expected \`${name}\` to be a number${allowInfinity ? " or Infinity" : ""}.`);
  }
  if (!allowInfinity && !Number.isFinite(value)) {
    throw new TypeError(`Expected \`${name}\` to be a finite number.`);
  }
  if (value < min) {
    throw new TypeError(`Expected \`${name}\` to be \u2265 ${min}.`);
  }
}
function validateFunctionOption(name, value) {
  if (value === void 0) {
    return;
  }
  if (typeof value !== "function") {
    throw new TypeError(`Expected \`${name}\` to be a function.`);
  }
}
var AbortError = class extends Error {
  constructor(message2) {
    super();
    if (message2 instanceof Error) {
      this.originalError = message2;
      ({ message: message2 } = message2);
    } else {
      this.originalError = new Error(message2);
      this.originalError.stack = this.stack;
    }
    this.name = "AbortError";
    this.message = message2;
  }
};
function calculateDelay(retriesConsumed, options) {
  const attempt = Math.max(1, retriesConsumed + 1);
  const random = options.randomize ? Math.random() + 1 : 1;
  let timeout = Math.round(random * options.minTimeout * options.factor ** (attempt - 1));
  timeout = Math.min(timeout, options.maxTimeout);
  return timeout;
}
function calculateRemainingTime(start, max) {
  if (!Number.isFinite(max)) {
    return max;
  }
  return max - (performance.now() - start);
}
async function delayForRetry(delay3, options) {
  if (delay3 <= 0) {
    return;
  }
  await new Promise((resolve4, reject) => {
    const onAbort = () => {
      clearTimeout(timeoutToken);
      options.signal?.removeEventListener("abort", onAbort);
      reject(options.signal.reason);
    };
    const timeoutToken = setTimeout(() => {
      options.signal?.removeEventListener("abort", onAbort);
      resolve4();
    }, delay3);
    if (options.unref) {
      timeoutToken.unref?.();
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function onAttemptFailure({ error, attemptNumber, retriesConsumed, startTime, options }) {
  const normalizedError = error instanceof Error ? error : new TypeError(`Non-error was thrown: "${error}". You should only throw errors.`);
  if (normalizedError instanceof AbortError) {
    throw normalizedError.originalError;
  }
  const retriesLeft = Number.isFinite(options.retries) ? Math.max(0, options.retries - retriesConsumed) : options.retries;
  const maxRetryTime = options.maxRetryTime ?? Number.POSITIVE_INFINITY;
  const delayTime = calculateDelay(retriesConsumed, options);
  const remainingTimeBeforeCallbacks = calculateRemainingTime(startTime, maxRetryTime);
  if (remainingTimeBeforeCallbacks <= 0) {
    const context2 = Object.freeze({
      error: normalizedError,
      attemptNumber,
      retriesLeft,
      retriesConsumed,
      retryDelay: 0
    });
    await options.onFailedAttempt(context2);
    throw normalizedError;
  }
  const consumeRetryContext = Object.freeze({
    error: normalizedError,
    attemptNumber,
    retriesLeft,
    retriesConsumed,
    retryDelay: retriesLeft > 0 ? delayTime : 0
  });
  const consumeRetry = await options.shouldConsumeRetry(consumeRetryContext);
  const effectiveDelay = consumeRetry && retriesLeft > 0 ? delayTime : 0;
  const context = Object.freeze({
    error: normalizedError,
    attemptNumber,
    retriesLeft,
    retriesConsumed,
    retryDelay: effectiveDelay
  });
  await options.onFailedAttempt(context);
  if (calculateRemainingTime(startTime, maxRetryTime) <= 0) {
    throw normalizedError;
  }
  const remainingTime = calculateRemainingTime(startTime, maxRetryTime);
  if (remainingTime <= 0 || retriesLeft <= 0) {
    throw normalizedError;
  }
  if (normalizedError instanceof TypeError && !isNetworkError(normalizedError)) {
    throw normalizedError;
  }
  if (!await options.shouldRetry(context)) {
    throw normalizedError;
  }
  const remainingTimeAfterShouldRetry = calculateRemainingTime(startTime, maxRetryTime);
  if (remainingTimeAfterShouldRetry <= 0) {
    throw normalizedError;
  }
  if (!consumeRetry) {
    options.signal?.throwIfAborted();
    return false;
  }
  const finalDelay = Math.min(effectiveDelay, remainingTimeAfterShouldRetry);
  options.signal?.throwIfAborted();
  await delayForRetry(finalDelay, options);
  options.signal?.throwIfAborted();
  return true;
}
async function pRetry(input, options = {}) {
  options = { ...options };
  validateRetries(options.retries);
  if (Object.hasOwn(options, "forever")) {
    throw new Error("The `forever` option is no longer supported. For many use-cases, you can set `retries: Infinity` instead.");
  }
  options.retries ??= 10;
  options.factor ??= 2;
  options.minTimeout ??= 1e3;
  options.maxTimeout ??= Number.POSITIVE_INFINITY;
  options.maxRetryTime ??= Number.POSITIVE_INFINITY;
  options.randomize ??= false;
  options.onFailedAttempt ??= () => {
  };
  options.shouldRetry ??= () => true;
  options.shouldConsumeRetry ??= () => true;
  validateFunctionOption("onFailedAttempt", options.onFailedAttempt);
  validateFunctionOption("shouldRetry", options.shouldRetry);
  validateFunctionOption("shouldConsumeRetry", options.shouldConsumeRetry);
  validateNumberOption("factor", options.factor, { min: 0, allowInfinity: false });
  validateNumberOption("minTimeout", options.minTimeout, { min: 0, allowInfinity: false });
  validateNumberOption("maxTimeout", options.maxTimeout, { min: 0, allowInfinity: true });
  validateNumberOption("maxRetryTime", options.maxRetryTime, { min: 0, allowInfinity: true });
  if (!(options.factor > 0)) {
    options.factor = 1;
  }
  options.signal?.throwIfAborted();
  let attemptNumber = 0;
  let retriesConsumed = 0;
  const startTime = performance.now();
  while (Number.isFinite(options.retries) ? retriesConsumed <= options.retries : true) {
    attemptNumber++;
    try {
      options.signal?.throwIfAborted();
      const result = await input(attemptNumber);
      options.signal?.throwIfAborted();
      return result;
    } catch (error) {
      if (await onAttemptFailure({
        error,
        attemptNumber,
        retriesConsumed,
        startTime,
        options
      })) {
        retriesConsumed++;
      }
    }
  }
  throw new Error("Retry attempts exhausted without throwing an error.");
}

// ../elt/packages/destinations/sqlite/dist/sqlite-catalog.js
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

// ../elt/node_modules/@zukhruf/sqlite-transaction/dist/transaction.js
var SAVEPOINT = "zukhruf_transaction";
function transaction(database, work, options) {
  const owns = !database.isTransaction;
  database.exec(owns ? `BEGIN ${options.mode.toUpperCase()}` : `SAVEPOINT ${SAVEPOINT}`);
  try {
    const result = work();
    if (thenable(result))
      throw new TypeError("A transaction function cannot return a promise");
    database.exec(owns ? "COMMIT" : `RELEASE ${SAVEPOINT}`);
    return result;
  } catch (error) {
    if (database.isTransaction)
      database.exec(owns ? "ROLLBACK" : `ROLLBACK TO ${SAVEPOINT}; RELEASE ${SAVEPOINT}`);
    throw error;
  }
}
function thenable(value) {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

// ../elt/node_modules/@zukhruf/sqlite-drift/dist/declaration.js
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// ../elt/node_modules/@zukhruf/sqlite-drift/node_modules/@zukhruf/sqlite-transaction/dist/transaction.js
var SAVEPOINT2 = "zukhruf_transaction";
function transaction2(database, work, options) {
  const owns = !database.isTransaction;
  database.exec(owns ? `BEGIN ${options.mode.toUpperCase()}` : `SAVEPOINT ${SAVEPOINT2}`);
  try {
    const result = work();
    if (thenable2(result))
      throw new TypeError("A transaction function cannot return a promise");
    database.exec(owns ? "COMMIT" : `RELEASE ${SAVEPOINT2}`);
    return result;
  } catch (error) {
    if (database.isTransaction)
      database.exec(owns ? "ROLLBACK" : `ROLLBACK TO ${SAVEPOINT2}; RELEASE ${SAVEPOINT2}`);
    throw error;
  }
}
function thenable2(value) {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

// ../elt/node_modules/@zukhruf/sqlite-drift/dist/declaration.js
var Declaration = class {
  #objects;
  #rows;
  constructor(statements, options) {
    var _stack = [];
    try {
      const blank = __using(_stack, new DatabaseSync(":memory:"));
      for (const statement of statements)
        blank.exec(statement);
      this.#objects = blank.prepare('SELECT "type", "name", "sql" FROM sqlite_schema WHERE "sql" IS NOT NULL ORDER BY rowid').all().map(({ type, name, sql }) => ({
        type: String(type),
        name: String(name),
        sql: String(sql)
      }));
      this.#rows = options.rows;
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  drift(database) {
    const pairs = this.#objects.map((object) => ({
      object,
      found: stored(database, object.name)
    }));
    if (pairs.every(({ found }) => found === void 0))
      return "missing";
    return pairs.every(({ object, found }) => found?.sql === object.sql) ? "fits" : "stale";
  }
  // Creates the objects the database does not store. When any stored object
  // differs from its declaration, rows 'replace' replaces every object of the
  // declaration, with its rows: a table can refer to another, and SQLite drops
  // a table only after nothing refers to its rows. Rows 'keep' makes each stale
  // object again, and moves the rows of a stale table into the new one (ADR
  // 0003). Works inside the caller's transaction, or in a write of its own.
  // Objects the declaration does not name stay.
  apply(database) {
    if (this.drift(database) === "fits")
      return;
    const unchecked = this.#rows === "keep" && Number(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys) === 1 && this.#stale(database).some(({ object, found }) => object.type === "table" && found.type === "table" && referenced(database, found.name));
    if (unchecked) {
      if (database.isTransaction)
        throw new Error("Keeping the rows of a table that other tables reference needs foreign keys off, which SQLite cannot change inside a transaction. Call apply outside a transaction, or turn foreign keys off before it.");
      database.exec("PRAGMA foreign_keys = OFF");
    }
    try {
      transaction2(database, () => {
        const stale = this.#stale(database);
        if (this.#rows === "keep") {
          const views = compiled(database);
          const rebuilt = this.#keep(database, stale);
          this.#create(database);
          verify(database, rebuilt, views);
        } else {
          if (stale.length > 0)
            for (const object of this.#objects.toReversed()) {
              const found = stored(database, object.name);
              if (found !== void 0)
                drop(database, found);
            }
          this.#create(database);
        }
      }, { mode: "immediate" });
    } finally {
      if (unchecked)
        database.exec("PRAGMA foreign_keys = ON");
    }
  }
  #create(database) {
    for (const object of this.#objects)
      if (stored(database, object.name) === void 0)
        database.exec(object.sql);
  }
  #stale(database) {
    return this.#objects.flatMap((object) => {
      const found = stored(database, object.name);
      return found !== void 0 && found.sql !== object.sql ? [{ object, found }] : [];
    });
  }
  // Drops each stale index, trigger and view, rebuilds each stale table, and
  // gives the names of the rebuilt tables. SQLite keeps PRAGMA
  // legacy_alter_table after a rollback, so the old value comes back in any
  // case.
  #keep(database, stale) {
    const tables2 = stale.filter(({ object, found }) => object.type === "table" && found.type === "table");
    for (const entry of stale)
      if (!tables2.includes(entry))
        drop(database, entry.found);
    if (tables2.length === 0)
      return [];
    const legacy = Number(database.prepare("PRAGMA legacy_alter_table").get()?.legacy_alter_table);
    database.exec("PRAGMA legacy_alter_table = ON");
    try {
      for (const { object, found } of tables2)
        this.#rebuild(database, object, found);
    } finally {
      database.exec(`PRAGMA legacy_alter_table = ${legacy}`);
    }
    const broken = database.prepare("PRAGMA foreign_key_check").get();
    if (broken !== void 0)
      throw new Error(`The kept rows break a foreign key: row ${String(broken.rowid)} of ${String(broken.table)} refers to a row of ${String(broken.parent)} that does not exist.`);
    return tables2.map(({ object }) => object.name);
  }
  // Renames the stored table away, makes it from its declared text, and copies
  // the columns that both have, by name. With legacy_alter_table on, the
  // rename leaves the references of other tables, views and triggers to the
  // name. A column only the declaration has gets its default, and a column
  // only the stored table has is discarded. The indexes and triggers on the
  // table go with the old table, so those the declaration does not name are
  // made again here, and the others when apply makes the missing objects.
  #rebuild(database, object, found) {
    const declared = new Set(this.#objects.map(({ name }) => name.toLowerCase()));
    const undeclared = database.prepare(`SELECT "name", "sql" FROM sqlite_schema WHERE lower("tbl_name") = lower(?) AND "type" IN ('index', 'trigger') AND "sql" IS NOT NULL`).all(found.name).filter(({ name }) => !declared.has(String(name).toLowerCase())).map(({ sql }) => String(sql));
    const old = `${found.name}_${randomUUID().replaceAll("-", "")}`;
    database.exec(`ALTER TABLE ${quote(found.name)} RENAME TO ${quote(old)}`);
    database.exec(object.sql);
    const columns2 = new Set(names(database, object.name).map((name) => name.toLowerCase()));
    const shared = names(database, old).filter((name) => columns2.has(name.toLowerCase())).map(quote).join(", ");
    if (shared !== "")
      database.exec(`INSERT INTO ${quote(object.name)} (${shared}) SELECT ${shared} FROM ${quote(old)}`);
    database.exec(`DROP TABLE ${quote(old)}`);
    for (const sql of undeclared)
      database.exec(sql);
  }
};
function stored(database, name) {
  const row = database.prepare('SELECT "type", "name", "sql" FROM sqlite_schema WHERE lower("name") = lower(?)').get(name);
  return row === void 0 ? void 0 : { type: String(row.type), name: String(row.name), sql: String(row.sql) };
}
function quote(name) {
  return `"${name.replaceAll('"', '""')}"`;
}
function drop(database, object) {
  database.exec(`DROP ${object.type.toUpperCase()} ${quote(object.name)}`);
}
function names(database, table) {
  return database.prepare('SELECT "name" FROM pragma_table_info(?)').all(table).map(({ name }) => String(name));
}
function compiled(database) {
  return new Set(database.prepare(`SELECT "name" FROM sqlite_schema WHERE "type" = 'view'`).all().map(({ name }) => String(name)).filter((name) => {
    try {
      database.prepare(`SELECT * FROM ${quote(name)} WHERE 0`);
      return true;
    } catch {
      return false;
    }
  }));
}
function verify(database, tables2, views) {
  for (const table of tables2) {
    const columns2 = names(database, table).map(quote);
    const name = quote(table);
    database.prepare(`DELETE FROM ${name} WHERE 0`);
    database.prepare(`INSERT INTO ${name} (${columns2.join(", ")}) SELECT ${columns2.join(", ")} FROM ${name} WHERE 0`);
    database.prepare(`UPDATE ${name} SET ${columns2.map((column) => `${column} = ${column}`).join(", ")} WHERE 0`);
  }
  for (const view of views)
    try {
      database.prepare(`SELECT * FROM ${quote(view)} WHERE 0`);
    } catch (error) {
      throw new Error(`The rebuild breaks the view ${view}.`, {
        cause: error
      });
    }
}
function referenced(database, table) {
  return database.prepare(`SELECT 1 FROM sqlite_schema AS "s", pragma_foreign_key_list("s"."name") AS "f" WHERE "s"."type" = 'table' AND lower("f"."table") = lower(?)`).get(table) !== void 0;
}

// ../elt/packages/destinations/sqlite/dist/sqlite-identifiers.js
var SQLiteIdentifiers = class extends Identifiers {
  maxBytes = Infinity;
  ownColumns = ["loaded_at"];
  key(name) {
    return name.replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase());
  }
};
var identifiers = Object.freeze(new SQLiteIdentifiers());

// ../elt/packages/destinations/sqlite/dist/sqlite-descriptions.js
var descriptions = '"_elt_descriptions"';
var descriptionsTable = new Declaration([
  `CREATE TABLE ${descriptions} ("relation" TEXT NOT NULL COLLATE NOCASE, "column" TEXT NOT NULL COLLATE NOCASE, "data_type" TEXT, "description" TEXT NOT NULL, PRIMARY KEY ("relation", "column")) STRICT`
], { rows: "replace" });
function createDescriptions(database) {
  descriptionsTable.apply(database);
}
function describe(database, relation, description, columns2) {
  createDescriptions(database);
  database.exec(`DELETE FROM ${descriptions} WHERE "relation" NOT IN (SELECT "name" FROM sqlite_schema)`);
  database.prepare(`DELETE FROM ${descriptions} WHERE "relation" = ?`).run(relation);
  const declared = new Map(database.prepare('SELECT "name", "type" FROM pragma_table_info(?)').all(relation).map(({ name, type }) => [
    identifiers.key(String(name)),
    String(type).toLowerCase() || null
  ]));
  const insert = database.prepare(`INSERT INTO ${descriptions} ("relation", "column", "data_type", "description") VALUES (?, ?, ?, ?)`);
  insert.run(relation, "", null, description);
  for (const [column, { description: description2, dataType }] of Object.entries(columns2))
    if (description2 !== null)
      insert.run(relation, column, dataType ?? declared.get(identifiers.key(column)) ?? null, description2);
}

// ../elt/packages/destinations/sqlite/dist/sqlite-views.js
var quote2 = (name) => `"${name.replaceAll('"', '""')}"`;
function viewDefinition(view) {
  return `CREATE VIEW ${quote2(view.name)} AS ${view.query}`;
}
function text(value, what) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || !value.isWellFormed())
    throw new TypeError(`Invalid ${what}`);
}
function publishSQLiteViews(database, { views }) {
  const names3 = /* @__PURE__ */ new Set();
  for (const view of views) {
    text(view.name, "view name");
    if (/^_elt_/i.test(view.name))
      throw new TypeError("View names starting with _elt_ are reserved");
    if (names3.has(view.name.toLowerCase()))
      throw new TypeError("Duplicate view names");
    names3.add(view.name.toLowerCase());
    text(view.query, "view query");
    text(view.description, "view description");
    for (const [column, description] of Object.entries(view.columns)) {
      text(column, "column name");
      text(description, "column description");
    }
  }
  if (views.length === 0)
    return;
  transaction(database, () => {
    for (const view of views.toReversed())
      database.exec(`DROP VIEW IF EXISTS ${quote2(view.name)}`);
    for (const view of views) {
      database.prepare(viewDefinition(view)).run();
      const columns2 = database.prepare('SELECT "name" FROM pragma_table_info(?)').all(view.name).map(({ name }) => String(name));
      if (columns2.length !== Object.keys(view.columns).length || columns2.some((name) => !Object.hasOwn(view.columns, name)))
        throw new TypeError(`View ${quote2(view.name)} must describe exactly its output columns: ${columns2.join(", ")}`);
      describe(database, view.name, view.description, Object.fromEntries(Object.entries(view.columns).map(([column, description]) => [
        column,
        { description }
      ])));
    }
  }, { mode: "deferred" });
}

// ../elt/packages/destinations/sqlite/dist/sqlite-catalog.js
function installSQLiteCatalog({ path }) {
  var _stack = [];
  try {
    if (path === ":memory:")
      throw new TypeError("A SQLite catalog requires a database file");
    const database = __using(_stack, new DatabaseSync2(path, { timeout: 3e4 }));
    transaction(database, () => {
      createDescriptions(database);
      publishSQLiteViews(database, {
        views: [
          {
            ...readerCatalog,
            query: `SELECT 'view' AS "kind", s."name" AS "name", NULL AS "data_type", d."description" AS "description"
            FROM sqlite_schema s JOIN ${descriptions} d ON d."relation" = s."name" AND d."column" = ''
            WHERE s."type" = 'view'
            UNION ALL
            SELECT 'column', s."name" || '.' || c."column", c."data_type", c."description"
            FROM sqlite_schema s JOIN ${descriptions} d ON d."relation" = s."name" AND d."column" = ''
            JOIN ${descriptions} c ON c."relation" = s."name" AND c."column" <> ''
            WHERE s."type" = 'view'
            ORDER BY 2`
          }
        ]
      });
    }, { mode: "immediate" });
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    __callDispose(_stack, _error, _hasError);
  }
}

// ../elt/packages/destinations/sqlite/dist/sqlite-checkpoint-store.js
import { chmodSync } from "node:fs";
import { resolve as resolve2 } from "node:path";
import { DatabaseSync as DatabaseSync4 } from "node:sqlite";

// ../elt/node_modules/@zukhruf/async/dist/latch.js
var Latch = class {
  /** Holds the value in a box, so it never adopts a promise and never rejects, whatever `T` is. */
  // eslint-disable-next-line zukhruf/no-promise-field -- A latch never rejects and is never replaced, so no hazard of the rule applies; it is the primitive the rule recommends.
  #opened = Promise.withResolvers();
  /**
   * A later open changes nothing. A type that names a promise is refused: a
   * wait would adopt the promise, and could then reject.
   */
  open(value) {
    this.#opened.resolve({ value });
  }
  wait() {
    return this.#opened.promise.then(({ value }) => value);
  }
};

// ../elt/node_modules/@zukhruf/async/dist/poll.js
import { setTimeout as delay } from "node:timers/promises";

// ../elt/node_modules/@zukhruf/async/dist/until-aborted.js
import { addAbortListener } from "node:events";
function untilAborted(promise, signal) {
  if (!signal)
    return promise;
  return new Promise((resolve4, reject) => {
    const listening = addAbortListener(signal, () => reject(signal.reason));
    promise.then((value) => {
      listening[Symbol.dispose]();
      resolve4(value);
    }, (error) => {
      listening[Symbol.dispose]();
      reject(error);
    });
  });
}

// ../elt/node_modules/@zukhruf/async/dist/poll.js
async function poll(attempt, { interval, signal, deadline, ref }) {
  for (; ; ) {
    const value = await attempt();
    if (value !== void 0)
      return value;
    if (deadline !== void 0 && performance.now() >= deadline) {
      return void 0;
    }
    await untilAborted(delay(interval, void 0, { signal, ref }), signal);
  }
}

// ../elt/node_modules/@zukhruf/lease/dist/lease-lost-error.js
var LeaseLostError = class extends Error {
  subject;
  constructor(subject, options) {
    super(`Lost the lease on ${JSON.stringify(subject)}: another holder may have it now.`, options);
    this.name = "LeaseLostError";
    this.subject = subject;
  }
};

// ../elt/node_modules/@zukhruf/lease/dist/lease-controller.js
var LeaseController = class {
  #subject;
  #lost = new AbortController();
  /** Aborts once the lease ends, by a loss or by `end()`. */
  #ended = new AbortController();
  constructor(subject) {
    this.#subject = subject;
  }
  get signal() {
    return this.#lost.signal;
  }
  /**
   * Another holder may have the right now. Aborts `signal` with a
   * `LeaseLostError` that carries `cause`, when one is given. A lease is lost
   * at most once, and never after it ended: a released right is not this
   * holder's to lose.
   */
  lose(cause) {
    if (this.#ended.signal.aborted)
      return;
    this.#ended.abort();
    this.#lost.abort(new LeaseLostError(this.#subject, cause === void 0 ? void 0 : { cause }));
  }
  /** The holder released the lease. `signal` keeps its state, and a later `lose` does nothing. */
  end() {
    this.#ended.abort();
  }
};

// ../elt/node_modules/@zukhruf/mutex/dist/mutex/acquire-modes/wait-mode.js
var WaitMode = class {
  outcome = "always";
  acquire(store, key, options) {
    return store.acquire(key, options);
  }
};

// ../elt/node_modules/@zukhruf/mutex/dist/mutex/key.js
var Key = class {
  name;
  #mutex;
  #mode;
  constructor(mutex, name, mode) {
    this.#mutex = mutex;
    this.name = name;
    this.#mode = mode;
  }
  /** Whether the key has a holder now, learned without acquiring it. The holder can change before the answer arrives. */
  isHeld() {
    return this.#mutex.isHeld(this.name);
  }
  run(task, { mode, signal } = {}) {
    return mode === void 0 ? this.#mutex.acquire(this.name, task, { mode: this.#mode, signal }) : this.#mutex.acquire(this.name, task, { mode, signal });
  }
};

// ../elt/node_modules/@zukhruf/mutex/dist/mutex/mutex.js
var wait = new WaitMode();
var ran = (value) => ({
  always: value,
  maybe: { acquired: true, value }
});
var gaveUp = (key) => ({
  get always() {
    throw new Error(`An acquire mode whose outcome is 'always' gave up on key "${key}".`);
  },
  maybe: { acquired: false }
});
var Mutex = class {
  #store;
  constructor(store) {
    this.#store = store;
  }
  acquire(key, task, { mode, signal } = {}) {
    return mode === void 0 ? this.#run(key, task, wait, signal) : this.#run(key, task, mode, signal);
  }
  /** Whether `key` has a holder now, learned without acquiring it. The holder can change before the answer arrives. */
  isHeld(key) {
    return this.#store.isHeld(key);
  }
  key(name, { mode } = {}) {
    return mode === void 0 ? new Key(this, name, wait) : new Key(this, name, mode);
  }
  // `mode.outcome` has the type O, so TypeScript checks each result below
  // against OutcomeResults<T>[O] and needs no type assertion.
  async #run(key, task, mode, signal) {
    var _stack = [];
    try {
      const handle = await this.#acquire(key, mode, signal);
      if (!handle)
        return gaveUp(key)[mode.outcome];
      const held2 = __using(_stack, handle, true);
      const { token, signal: lost } = held2;
      let value;
      try {
        value = await task({ token, signal: lost });
      } catch (error) {
        if (!lost.aborted || error === lost.reason)
          throw error;
        throw new LeaseLostError(key, { cause: error });
      }
      if (lost.aborted)
        throw lost.reason;
      return ran(value)[mode.outcome];
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      var _promise = __callDispose(_stack, _error, _hasError);
      _promise && await _promise;
    }
  }
  // A cancelled caller never takes a key, even a free one. A mode that does
  // not pass the signal on still rejects at once, and gives its late lease back.
  async #acquire(key, mode, signal) {
    signal?.throwIfAborted();
    const acquiring = mode.acquire(this.#store, key, { signal });
    try {
      return await untilAborted(acquiring, signal);
    } catch (error) {
      if (signal?.aborted)
        void giveBack(acquiring);
      throw error;
    }
  }
};
async function giveBack(acquiring) {
  try {
    await (await acquiring)?.[Symbol.asyncDispose]();
  } catch {
  }
}

// ../elt/node_modules/@zukhruf/mutex/dist/mutex/lease.js
async function leaseFor(key, held2, tokens) {
  var _stack = [];
  try {
    const minting = __using(_stack, new AsyncDisposableStack(), true);
    minting.use(held2);
    const token = await tokens.next(key);
    minting.move();
    const lease = new LeaseController(key);
    return {
      token,
      signal: lease.signal,
      // Not a disposable stack: it would release the lock a turn later, and a
      // coordinator that reads a release and then a look in one turn would
      // answer that look from the lock it still holds.
      [Symbol.asyncDispose]: () => {
        lease.end();
        return held2[Symbol.asyncDispose]();
      }
    };
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    var _promise = __callDispose(_stack, _error, _hasError);
    _promise && await _promise;
  }
}

// ../elt/node_modules/@zukhruf/mutex/dist/mutex/acquire-modes/skip-if-busy-mode.js
var SkipIfBusyMode = class {
  outcome = "maybe";
  #waitAtMost;
  constructor({ waitAtMost = 0 } = {}) {
    if (!(waitAtMost >= 0) || !Number.isFinite(waitAtMost)) {
      throw new RangeError(`waitAtMost must be a finite number of milliseconds >= 0, got ${waitAtMost}.`);
    }
    this.#waitAtMost = waitAtMost;
  }
  async acquire(store, key, { signal }) {
    const lease = await store.tryAcquire(key);
    if (lease || this.#waitAtMost === 0)
      return lease;
    const timeout = AbortSignal.timeout(this.#waitAtMost);
    try {
      return await store.acquire(key, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      });
    } catch (error) {
      if (timeout.aborted && error === timeout.reason)
        return void 0;
      throw error;
    }
  }
};

// ../elt/node_modules/@zukhruf/mutex/dist/mutex/acquire-modes/modes.js
var Modes = {
  /** Wait until the key is granted. The task always runs. */
  wait: () => new WaitMode(),
  /** Give up when the key stays busy, at once or after `waitAtMost` ms. The task may not run. */
  skipIfBusy: (options) => new SkipIfBusyMode(options)
};

// ../elt/node_modules/@zukhruf/fs/dist/atomic-write.js
import { rm, writeFile } from "node:fs/promises";

// ../elt/node_modules/@zukhruf/fs/dist/draft.js
import { randomUUID as randomUUID2 } from "node:crypto";
var draftOf = (path) => `${path}.${randomUUID2()}.tmp`;
var draftSuffixLength = draftOf("").length;

// ../elt/node_modules/@zukhruf/fs/dist/replace-file.js
import { rename } from "node:fs/promises";

// ../elt/node_modules/@zukhruf/fs/dist/patiently.js
import { setTimeout as delay2 } from "node:timers/promises";

// ../elt/node_modules/@zukhruf/fs/dist/errno.js
function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

// ../elt/node_modules/@zukhruf/fs/dist/patiently.js
var WINDOWS_PATIENCE = 1e3;
function isRefusedForNow(error) {
  return process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].some((code) => isErrno(error, code));
}
async function patiently(operation) {
  const started = performance.now();
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRefusedForNow(error) || performance.now() - started > WINDOWS_PATIENCE)
        throw error;
      await delay2(Math.min(5 * 2 ** attempt, 100));
    }
  }
}

// ../elt/node_modules/@zukhruf/fs/dist/replace-file.js
function replaceFile(draft, path) {
  return patiently(() => rename(draft, path));
}

// ../elt/node_modules/@zukhruf/fs/dist/atomic-write.js
async function atomicWrite(path, content) {
  const draft = draftOf(path);
  try {
    await writeFile(draft, content);
    await replaceFile(draft, path);
  } catch (error) {
    await rm(draft, { force: true });
    throw error;
  }
}

// ../elt/node_modules/@zukhruf/fs/dist/durable-write.js
import { open, rm as rm2 } from "node:fs/promises";
import { dirname } from "node:path";
async function durableWrite(path, content) {
  const draft = draftOf(path);
  try {
    await writeSynced(draft, content);
    await replaceFile(draft, path);
  } catch (error) {
    await rm2(draft, { force: true });
    throw error;
  }
  await syncDirectory(dirname(path));
}
async function writeSynced(path, content) {
  var _stack = [];
  try {
    const handle = __using(_stack, await open(path, "wx"), true);
    await handle.writeFile(content);
    await handle.sync();
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    var _promise = __callDispose(_stack, _error, _hasError);
    _promise && await _promise;
  }
}
async function syncDirectory(directory) {
  var _stack = [];
  try {
    if (process.platform === "win32")
      return;
    const handle = __using(_stack, await open(directory, "r"), true);
    try {
      await handle.sync();
    } catch (error) {
      if (!isErrno(error, "EINVAL") && !isErrno(error, "ENOTSUP"))
        throw error;
    }
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    var _promise = __callDispose(_stack, _error, _hasError);
    _promise && await _promise;
  }
}

// ../elt/node_modules/@zukhruf/fs/dist/file-lock.js
import { existsSync } from "node:fs";
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";
var SQLITE_BUSY = 5;
var SQLITE_CANTOPEN = 14;
var held = /* @__PURE__ */ new Set();
var FileLock = class _FileLock {
  #path;
  #database;
  constructor(path, database) {
    this.#path = path;
    this.#database = database;
  }
  /** Opens the file, and creates it empty when it is absent. Takes no lock. */
  static open(path) {
    return new _FileLock(path, new DatabaseSync3(path));
  }
  /**
   * Whether a handle holds the lock on the file at `path` now. It reads
   * the file once, read-only, and never creates it. For that read it takes a
   * shared lock, so a `tryLock` at that moment can return `false`. The answer
   * can be stale as soon as it returns.
   */
  static check(path) {
    let database;
    try {
      database = new DatabaseSync3(path, { readOnly: true });
    } catch (error) {
      if (hasResultCode(error, SQLITE_CANTOPEN) && !existsSync(path)) {
        return "missing";
      }
      throw error;
    }
    try {
      database.prepare("SELECT count(*) FROM sqlite_schema").get();
      return "unlocked";
    } catch (error) {
      if (hasResultCode(error, SQLITE_BUSY))
        return "locked";
      throw error;
    } finally {
      database.close();
    }
  }
  /** Takes the lock without waiting. Returns `false` when another handle holds it. */
  tryLock() {
    if (this.#database.isTransaction) {
      throw new Error(`This handle holds the file lock ${JSON.stringify(this.#path)} already.`);
    }
    try {
      this.#database.exec("PRAGMA journal_mode = MEMORY");
      this.#database.exec("BEGIN EXCLUSIVE");
    } catch (error) {
      if (hasResultCode(error, SQLITE_BUSY))
        return false;
      throw error;
    }
    held.add(this.#database);
    return true;
  }
  /** Lets the lock go. The handle stays open for the next `tryLock`. */
  unlock() {
    if (!this.#database.isTransaction) {
      throw new Error(`This handle does not hold the file lock ${JSON.stringify(this.#path)}.`);
    }
    this.#database.exec("ROLLBACK");
    held.delete(this.#database);
  }
  /** Closes the handle. A lock that it holds goes with it. */
  [Symbol.dispose]() {
    held.delete(this.#database);
    this.#database[Symbol.dispose]();
  }
};
function hasResultCode(error, code) {
  return error instanceof Error && "errcode" in error && typeof error.errcode === "number" && (error.errcode & 255) === code;
}

// ../elt/node_modules/@zukhruf/fs/dist/local-directory.js
import { statfs } from "node:fs/promises";
import { dirname as dirname2, resolve } from "node:path";

// ../elt/node_modules/@zukhruf/fs/dist/network-directory-error.js
var NetworkDirectoryError = class extends Error {
  directory;
  /** The network file system the directory is on, for example `NFS`. */
  fileSystem;
  constructor(directory, fileSystem) {
    super(`The directory ${JSON.stringify(directory)} is on a network file system (${fileSystem}), where file locks are not shared reliably between machines. Use a local directory.`);
    this.name = "NetworkDirectoryError";
    this.directory = directory;
    this.fileSystem = fileSystem;
  }
};

// ../elt/node_modules/@zukhruf/fs/dist/local-directory.js
var linuxNetworkFileSystems = /* @__PURE__ */ new Map([
  [0x6969n, "NFS"],
  [0x517bn, "SMB"],
  [0xff534d42n, "CIFS"],
  [0xfe534d42n, "SMB2"],
  [0x00c36400n, "Ceph"],
  [0x5346414fn, "AFS"],
  [0x6b414653n, "kAFS"],
  [0x73757245n, "Coda"],
  [0x564cn, "NCP"],
  [0x7461636fn, "OCFS2"],
  [0x01161970n, "GFS2"],
  [0x0bd00bd0n, "Lustre"],
  [0x01021997n, "9p"]
]);
var local = { kind: "local" };
var unknown = { kind: "unknown" };
var judges = {
  linux: (path) => statfsOfNearest(path).then(({ type }) => {
    const fileSystem = linuxNetworkFileSystems.get(BigInt.asUintN(32, type));
    return fileSystem ? { kind: "network", fileSystem } : local;
  }, () => unknown),
  win32: async (path) => isUncPath(path) ? { kind: "network", fileSystem: "UNC share" } : local
};
var localDirectories = /* @__PURE__ */ new Set();
async function assertLocalDirectory(directory) {
  const path = resolve(directory);
  if (localDirectories.has(path))
    return;
  const judgement = await judges[process.platform]?.(path) ?? local;
  if (judgement.kind === "network") {
    throw new NetworkDirectoryError(directory, judgement.fileSystem);
  }
  if (judgement.kind === "local")
    localDirectories.add(path);
}
async function statfsOfNearest(path) {
  try {
    return await statfs(path, { bigint: true });
  } catch (error) {
    const parent = dirname2(path);
    if (!isErrno(error, "ENOENT") || parent === path)
      throw error;
    return statfsOfNearest(parent);
  }
}
function isUncPath(path) {
  if (/^\\\\[?.]\\/.test(path))
    return /^\\\\[?.]\\UNC\\/i.test(path);
  return path.startsWith("\\\\");
}

// ../elt/node_modules/@zukhruf/fs/dist/safe-file-name.js
import { createHash } from "node:crypto";
var longestFileName = 255;
var windowsDevice = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
var visibleStart = 32;
function safeFileName(key, longestSuffix) {
  if (key.isWellFormed()) {
    const encoded = encode(key);
    if (encoded.length + longestSuffix <= longestFileName)
      return encoded;
  }
  const start = encode(key.toWellFormed()).slice(0, visibleStart).replace(/%[0-9A-F]?$/, "");
  const digest = createHash("sha256").update(Buffer.from(key, "utf16le")).digest("hex");
  return `${start}%%${digest}`;
}
function encode(key) {
  const encoded = encodeURIComponent(key).replaceAll(/%[0-9A-F]{2}|[.*A-Z]/g, (match) => match.length === 1 ? percentEncode(match) : match);
  return windowsDevice.test(encoded) ? percentEncode(encoded[0]) + encoded.slice(1) : encoded;
}
function percentEncode(character) {
  return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
}

// ../elt/node_modules/@zukhruf/mutex/dist/lock-stores/file-system/file-lock-store.js
import { mkdir as mkdir2 } from "node:fs/promises";
import { join as join2 } from "node:path";

// ../elt/node_modules/@zukhruf/fencing/dist/fencing-token.js
var FencingToken = class _FencingToken {
  value;
  constructor(value) {
    this.value = value;
  }
  /**
   * Reads decimal digits, the text that `toString` writes, or returns null for
   * any other text. `BigInt` alone would also accept `''`, `' 1'` and `'0x10'`,
   * and a token is never negative.
   */
  static parse(text3) {
    return /^\d+$/.test(text3) ? new _FencingToken(BigInt(text3)) : null;
  }
  isNewerThan(other) {
    return this.value > other.value;
  }
  toString() {
    return this.value.toString();
  }
};

// ../elt/node_modules/@zukhruf/fencing/dist/counter-token-source.js
var CounterTokenSource = class {
  #last = 0n;
  async next(_key) {
    this.#last++;
    return new FencingToken(this.#last);
  }
};

// ../elt/node_modules/@zukhruf/fencing/dist/epoch-token-source.js
var SEQUENCE_BITS = 32n;
var EPOCH_LIMIT = 1n << 31n;
var SEQUENCE_LIMIT = 1n << SEQUENCE_BITS;

// ../elt/node_modules/@zukhruf/fencing/dist/file-token-source.js
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
var FileTokenSource = class {
  #directory;
  constructor(directory) {
    this.#directory = directory;
  }
  async next(key) {
    await mkdir(this.#directory, { recursive: true });
    const name = safeFileName(key, ".fence".length + draftSuffixLength);
    const path = join(this.#directory, `${name}.fence`);
    const token = await readCounter(path) + 1n;
    await durableWrite(path, token.toString());
    return new FencingToken(token);
  }
};
async function readCounter(path) {
  let text3;
  try {
    text3 = await readFile(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT"))
      return 0n;
    throw error;
  }
  const counter = FencingToken.parse(text3);
  if (counter === null)
    throw new SyntaxError(`The fencing counter ${path} holds ${JSON.stringify(text3)}, not decimal digits.`);
  return counter.value;
}

// ../elt/node_modules/@zukhruf/mutex/dist/lock-stores/file-system/file-lock-store.js
var FileLockStore = class {
  #directory;
  #pollInterval;
  #tokens;
  constructor(directory, { pollInterval = 10, tokens = new FileTokenSource(directory) } = {}) {
    this.#directory = directory;
    this.#pollInterval = pollInterval;
    this.#tokens = tokens;
  }
  async acquire(key, { signal } = {}) {
    signal?.throwIfAborted();
    const held2 = await this.lock(await this.#prepare(key), signal);
    return leaseFor(key, held2, this.#tokens);
  }
  async tryAcquire(key) {
    const held2 = await this.tryLock(await this.#prepare(key));
    return held2 && leaseFor(key, held2, this.#tokens);
  }
  /** Makes no directory: a key in a directory that does not exist has no holder. */
  async isHeld(key) {
    await assertLocalDirectory(this.#directory);
    return this.isHeldAt(this.#pathFor(key));
  }
  /** Stops between attempts once `signal` aborts, and then rejects with `signal.reason`. */
  poll(attempt, signal) {
    return poll(attempt, { interval: this.#pollInterval, signal });
  }
  /**
   * Serializes evicting a dead holder. Without it, two waiters that saw the
   * same dead holder could each remove a lock the other had just taken. The
   * kernel holds this lock, so a waiter that dies while it evicts frees it at
   * once. Its file stays for the next eviction: deleting it while waiters use
   * it would let two of them lock two different files.
   */
  async withReclaimLock(path, task) {
    var _stack = [];
    try {
      const reclaimPath = `${path}.reclaim`;
      const reclaim = __using(_stack, FileLock.open(reclaimPath));
      if (!claim(reclaim, reclaimPath))
        return;
      await task();
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  async #prepare(key) {
    await assertLocalDirectory(this.#directory);
    await mkdir2(this.#directory, { recursive: true });
    return this.#pathFor(key);
  }
  #pathFor(key) {
    const name = safeFileName(key, ".lock".length + this.longestSuffix);
    return join2(this.#directory, `${name}.lock`);
  }
};
function claim(reclaim, path) {
  try {
    return reclaim.tryLock();
  } catch (error) {
    if (isNotADatabase(error)) {
      throw new Error(`The reclaim file ${JSON.stringify(path)} was left by an older version of @zukhruf/mutex. Stop the processes that run that version, then delete the file.`, { cause: error });
    }
    throw error;
  }
}
var SQLITE_NOTADB = 26;
function isNotADatabase(error) {
  return error instanceof Error && "errcode" in error && typeof error.errcode === "number" && (error.errcode & 255) === SQLITE_NOTADB;
}

// ../elt/node_modules/@zukhruf/mutex/dist/lock-stores/memory/memory-store.js
var MemoryStore = class {
  /** For each key, the latch that the last caller in line opens when it releases. */
  #lines = /* @__PURE__ */ new Map();
  #tokens;
  constructor({ tokens = new CounterTokenSource() } = {}) {
    this.#tokens = tokens;
  }
  async acquire(key, { signal } = {}) {
    signal?.throwIfAborted();
    const previous = this.#lines.get(key);
    const released = new Latch();
    this.#lines.set(key, released);
    const release = async () => {
      released.open();
      if (this.#lines.get(key) === released)
        this.#lines.delete(key);
    };
    const turn = previous?.wait() ?? Promise.resolve();
    try {
      await untilAborted(turn, signal);
    } catch (error) {
      void turn.then(release);
      throw error;
    }
    return leaseFor(key, { [Symbol.asyncDispose]: release }, this.#tokens);
  }
  async tryAcquire(key) {
    if (this.#lines.has(key))
      return void 0;
    return this.acquire(key);
  }
  /** The first caller in a key's line holds it, so a key with a line is held. */
  async isHeld(key) {
    return this.#lines.has(key);
  }
  /** True while a caller holds a key. A caller waits only behind a holder, so `false` also means that nobody waits. */
  get holdsAnyKey() {
    return this.#lines.size > 0;
  }
};

// ../elt/node_modules/@zukhruf/mutex/dist/lock-stores/sqlite/holder-record.js
import { mkdir as mkdir3, readdir, unlink as unlink2 } from "node:fs/promises";
import { basename, join as join3 } from "node:path";

// ../elt/node_modules/@zukhruf/mutex/dist/lock-stores/file-system/caller.js
import { randomUUID as randomUUID3 } from "node:crypto";
import { hostname } from "node:os";

// ../elt/node_modules/@zukhruf/mutex/dist/shared/is-record.js
var isRecord = (value) => typeof value === "object" && value !== null;

// ../elt/node_modules/@zukhruf/mutex/dist/lock-stores/file-system/caller.js
var Caller = class _Caller {
  pid;
  host;
  id;
  constructor(pid, host, id) {
    this.pid = pid;
    this.host = host;
    this.id = id;
  }
  static current() {
    return new _Caller(process.pid, hostname(), randomUUID3());
  }
  static parse(serialized) {
    const parsed = JSON.parse(serialized);
    if (!isRecord(parsed) || typeof parsed.pid !== "number" || typeof parsed.host !== "string" || typeof parsed.id !== "string") {
      throw new SyntaxError(`Not a lock caller: ${serialized}`);
    }
    return new _Caller(parsed.pid, parsed.host, parsed.id);
  }
  serialize() {
    return JSON.stringify({ pid: this.pid, host: this.host, id: this.id });
  }
};

// ../elt/node_modules/@zukhruf/mutex/dist/lock-stores/file-system/presence.js
import { unlink } from "node:fs/promises";
var Presence = class _Presence {
  #path;
  #lock;
  constructor(path, lock) {
    this.#path = path;
    this.#lock = lock;
  }
  /** The length of what `pathOf` adds to a record's path. */
  static suffixLength = _Presence.pathOf("", Caller.current()).length;
  /** The presence file of `caller`, whose record is at `record`. */
  static pathOf(record, caller) {
    return `${record}.${caller.id}.presence`;
  }
  /** Claims the presence of `caller`, whose record is at `record`. */
  static claim(record, caller) {
    var _stack = [];
    try {
      const path = _Presence.pathOf(record, caller);
      const opened = __using(_stack, new DisposableStack());
      const lock = opened.use(FileLock.open(path));
      if (!lock.tryLock()) {
        throw new Error(`The presence file ${JSON.stringify(path)} is locked already, but it belongs to one caller only. Another program opened it.`);
      }
      opened.move();
      return new _Presence(path, lock);
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /**
   * Whether `caller`, whom the record at `record` named, still runs. A caller's
   * record goes before its presence file, so a missing presence file is a
   * fault while `readNamed` still reads the caller from the record, and means
   * the caller `moved` on when it does not.
   */
  static async judge(record, caller, readNamed) {
    const path = _Presence.pathOf(record, caller);
    const state = FileLock.check(path);
    if (state === "locked")
      return "present";
    if (state === "unlocked")
      return "gone";
    if ((await readNamed())?.id === caller.id) {
      throw _Presence.missing(record, path);
    }
    return "moved";
  }
  /** Whether the caller that `readNamed` reads from the record at `record` still runs. Writes nothing. */
  static async isNamedCallerPresent(record, readNamed) {
    for (; ; ) {
      const caller = await readNamed();
      if (!caller)
        return false;
      const state = await _Presence.judge(record, caller, readNamed);
      if (state !== "moved")
        return state === "present";
    }
  }
  /** Deletes the file of a presence that has ended. */
  static async delete(path) {
    try {
      await patiently(() => unlink(path));
    } catch (error) {
      throw new Error(`The presence ${JSON.stringify(path)} has ended, but its file could not be deleted. The file locks nothing; delete it by hand.`, { cause: error });
    }
  }
  /** A record names a caller whose presence file does not exist, so nobody can tell whether it runs. */
  static missing(record, path) {
    return new Error(`The lock record ${JSON.stringify(record)} names a caller with no presence file ${JSON.stringify(path)}. An older version of @zukhruf/mutex wrote the record, or someone deleted the file. Stop every process that uses this lock directory, then delete the record.`);
  }
  /** Lets the kernel lock go. The file stays for whoever removes the caller's record. */
  end() {
    this.#lock[Symbol.dispose]();
  }
  /**
   * Removes the caller's record, then ends this presence and deletes its file.
   * A record that cannot be removed stays, but this presence ends anyway, so
   * the record reads as gone and a waiter evicts it.
   */
  async releaseAfter(removeRecord) {
    try {
      await removeRecord();
    } catch (error) {
      this.end();
      throw error;
    }
    this.end();
    await _Presence.delete(this.#path);
  }
  /** Ends a presence whose record never appeared, or is gone already. */
  async withdraw() {
    this.end();
    await _Presence.delete(this.#path);
  }
};

// ../elt/node_modules/@zukhruf/mutex/dist/lock-stores/file-system/record-file.js
import { readFileSync } from "node:fs";
async function readRecord(path) {
  try {
    return await patiently(async () => readFileSync(path, "utf8"));
  } catch (error) {
    if (isErrno(error, "ENOENT"))
      return void 0;
    throw error;
  }
}

// ../elt/node_modules/@zukhruf/mutex/dist/lock-stores/sqlite/holder-record.js
var HolderRecord = class {
  #folder;
  #path;
  constructor(lockPath) {
    this.#folder = `${lockPath}.holder`;
    this.#path = join3(this.#folder, "caller");
  }
  /**
   * Names this caller as the holder: its presence first, then the record that
   * names it, so a look never finds a record whose presence is still to come.
   */
  async announce() {
    var _stack = [];
    try {
      const me = Caller.current();
      await mkdir3(this.#folder, { recursive: true });
      const announcing = __using(_stack, new AsyncDisposableStack(), true);
      const presence = announcing.adopt(Presence.claim(this.#path, me), (claimed) => claimed.withdraw());
      await atomicWrite(this.#path, me.serialize());
      announcing.move();
      await this.#clearEarlierHolders(me);
      return {
        [Symbol.asyncDispose]: () => presence.releaseAfter(() => patiently(() => unlink2(this.#path)))
      };
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      var _promise = __callDispose(_stack, _error, _hasError);
      _promise && await _promise;
    }
  }
  /** Whether the holder that the record names still runs. Writes nothing. */
  isPresent() {
    return Presence.isNamedCallerPresent(this.#path, () => this.#read());
  }
  /**
   * Every other file in the folder was left by an earlier holder that stopped
   * before it removed its own. Such a file locks nothing, so a delete that
   * fails leaves it for the next holder and never fails this grant.
   */
  async #clearEarlierHolders(me) {
    const mine = /* @__PURE__ */ new Set([
      basename(this.#path),
      basename(Presence.pathOf(this.#path, me))
    ]);
    const names3 = await readdir(this.#folder).catch(() => []);
    await Promise.all(names3.filter((name) => !mine.has(name)).map((name) => unlink2(join3(this.#folder, name)).catch(() => {
    })));
  }
  async #read() {
    const content = await readRecord(this.#path);
    if (content === void 0)
      return void 0;
    try {
      return Caller.parse(content);
    } catch (error) {
      if (error instanceof SyntaxError)
        return void 0;
      throw error;
    }
  }
};

// ../elt/node_modules/@zukhruf/mutex/dist/lock-stores/sqlite/sqlite-store.js
var SqliteStore = class extends FileLockStore {
  /**
   * Published versions keep the rollback journal of a key's database at
   * `<path>-journal`. New versions keep it in memory, but a key keeps the file
   * name that those versions gave it, so both versions share its lock. The
   * holder folder `<path>.holder` is shorter.
   */
  longestSuffix = "-journal".length;
  #inProcess = new MemoryStore();
  async acquire(key, options = {}) {
    var _stack = [];
    try {
      const turn = __using(_stack, new AsyncDisposableStack(), true);
      turn.use(await this.#inProcess.acquire(key, options));
      return withTurn(await super.acquire(key, options), turn);
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      var _promise = __callDispose(_stack, _error, _hasError);
      _promise && await _promise;
    }
  }
  async tryAcquire(key) {
    var _stack = [];
    try {
      const turn = __using(_stack, new AsyncDisposableStack(), true);
      const inProcess = await this.#inProcess.tryAcquire(key);
      if (!inProcess)
        return void 0;
      turn.use(inProcess);
      const lease = await super.tryAcquire(key);
      return lease && withTurn(lease, turn);
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      var _promise = __callDispose(_stack, _error, _hasError);
      _promise && await _promise;
    }
  }
  async lock(path, signal) {
    var _stack = [];
    try {
      const held2 = __using(_stack, new AsyncDisposableStack(), true);
      const lock = held2.use(FileLock.open(path));
      await this.poll(async () => lock.tryLock() ? true : void 0, signal);
      held2.use(await new HolderRecord(path).announce());
      return held2.move();
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      var _promise = __callDispose(_stack, _error, _hasError);
      _promise && await _promise;
    }
  }
  async tryLock(path) {
    var _stack = [];
    try {
      const held2 = __using(_stack, new AsyncDisposableStack(), true);
      const lock = held2.use(FileLock.open(path));
      if (!lock.tryLock())
        return void 0;
      held2.use(await new HolderRecord(path).announce());
      return held2.move();
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      var _promise = __callDispose(_stack, _error, _hasError);
      _promise && await _promise;
    }
  }
  isHeldAt(path) {
    return new HolderRecord(path).isPresent();
  }
};
function withTurn(handle, turn) {
  turn.use(handle);
  const release = turn.move();
  return {
    token: handle.token,
    signal: handle.signal,
    [Symbol.asyncDispose]: () => release.disposeAsync()
  };
}

// ../elt/packages/destinations/sqlite/dist/sqlite-checkpoint-store.js
var checkpoints = new Declaration([
  "CREATE TABLE checkpoints (id TEXT PRIMARY KEY NOT NULL, binding TEXT NOT NULL, reloading INTEGER NOT NULL CHECK (reloading IN (0, 1)), state TEXT NOT NULL) STRICT"
], { rows: "replace" });
var SQLiteCheckpointStore = class extends CheckpointStore {
  path;
  // One key per replication, in a folder beside the state file. The kernel
  // releases a key when the run holding it exits.
  #locks;
  constructor({ path }) {
    super();
    if (!path || path === ":memory:" || path.includes("\0"))
      throw new TypeError("Checkpoints require a persistent SQLite file");
    this.path = resolve2(path);
    this.#locks = new Mutex(new SqliteStore(`${this.path}.locks`));
    Object.freeze(this);
  }
  // Holds each replication's key in turn, then works. A replication already
  // running fails the run fast; others run in parallel.
  async session(ids, work) {
    const [id, ...rest] = ids;
    if (id === void 0)
      return this.#withFile(work);
    const held2 = await this.#locks.acquire(id, () => this.session(rest, work), {
      mode: Modes.skipIfBusy()
    });
    if (!held2.acquired)
      throw new TypeError(`Checkpoint ${id} is in use by another run`);
    return held2.value;
  }
  // Each save commits on its own, so it is durable when it resolves.
  async #withFile(work) {
    var _stack = [];
    try {
      const database = __using(_stack, new DatabaseSync4(this.path, { timeout: 3e4 }));
      chmodSync(this.path, 384);
      checkpoints.apply(database);
      return await work({
        read: async (id) => {
          const saved = database.prepare("SELECT binding, reloading FROM checkpoints WHERE id = ?").get(id);
          return saved === void 0 ? void 0 : {
            binding: String(saved.binding),
            reloading: saved.reloading === 1
          };
        },
        state: async (id) => {
          const saved = database.prepare("SELECT state FROM checkpoints WHERE id = ?").get(id);
          return saved === void 0 ? void 0 : String(saved.state);
        },
        save: async (id, { binding, reloading, state }) => {
          database.prepare("INSERT INTO checkpoints (id, binding, reloading, state) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET binding = excluded.binding, reloading = excluded.reloading, state = excluded.state").run(id, binding, reloading ? 1 : 0, state);
        },
        reloaded: async (id) => {
          database.prepare("UPDATE checkpoints SET reloading = 0 WHERE id = ?").run(id);
        },
        remove: async (id) => {
          database.prepare("DELETE FROM checkpoints WHERE id = ?").run(id);
        }
      });
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
};

// ../elt/packages/destinations/sqlite/dist/sqlite-column.js
var storageTypes = {
  text: "TEXT",
  integer: "INTEGER",
  int64: "INTEGER",
  real: "REAL",
  decimal: "TEXT",
  blob: "BLOB",
  boolean: "INTEGER",
  date: "TEXT",
  timestamp: "TEXT",
  local_timestamp: "TEXT",
  local_time: "TEXT"
};
var formatKinds = {
  "date-time": "timestamp",
  date: "date",
  "date-time-local": "local_timestamp",
  "time-local": "local_time",
  int64: "int64",
  decimal: "decimal",
  base64: "blob"
};
var formatted = /* @__PURE__ */ new Set([
  "int64",
  "decimal",
  "local_timestamp",
  "local_time"
]);
var fraction = (precision) => precision === 0 ? "" : `.${"[0-9]".repeat(precision)}`;
var realSecond = (name) => `strftime('%Y-%m-%dT%H:%M:%S', substr(${name}, 1, 19)) IS substr(${name}, 1, 19)`;
function canonical(kind, name, format) {
  switch (kind) {
    case "boolean":
      return ` CHECK (${name} IN (0, 1))`;
    case "date":
      return ` CHECK (date(${name}) IS ${name})`;
    case "timestamp": {
      const precision = format?.name === "date-time" ? format.precision : 3;
      return precision === 3 ? ` CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', ${name}) IS ${name})` : ` CHECK (${realSecond(name)} AND substr(${name}, 20) GLOB '${fraction(precision)}Z')`;
    }
    case "local_timestamp":
      return format?.name === "date-time-local" ? ` CHECK (${realSecond(name)} AND substr(${name}, 20) GLOB '${fraction(format.precision)}')` : "";
    case "local_time":
      return format?.name === "time-local" ? ` CHECK (time(substr(${name}, 1, 8)) IS substr(${name}, 1, 8) AND substr(${name}, 9) GLOB '${fraction(format.precision)}')` : "";
    default:
      return "";
  }
}
var SQLiteColumn = class _SQLiteColumn {
  // The record field the column holds.
  field;
  // What SQLite calls the column, which the table it belongs to decides.
  name;
  kind;
  // The string format a schema-inferred column keeps, which refines its kind.
  format;
  isPrimaryKey;
  nullable;
  optional;
  // An array of kind, stored as a JSON array in TEXT.
  array;
  fileRead;
  constructor(field, kind, options) {
    if (typeof field !== "string")
      throw new TypeError("A column holds a field named by a string");
    if (!Object.hasOwn(storageTypes, kind))
      throw new TypeError("Unsupported SQLite column type");
    const { format } = options;
    if (format === void 0 ? formatted.has(kind) : formatKinds[format.name] !== kind)
      throw new TypeError(`Column ${field} kind ${kind} must match its format`);
    this.format = format;
    this.array = options.array ?? false;
    if (this.array && (kind === "blob" || options.primaryKey))
      throw new TypeError("Array columns hold scalar values and cannot be keys");
    this.fileRead = options.fileRead;
    if (this.fileRead !== void 0 && (!(this.fileRead instanceof FileRead) || this.fileRead.name !== field))
      throw new TypeError("Column file read must match its field");
    this.field = field;
    this.name = options.name ?? field;
    this.kind = kind;
    this.isPrimaryKey = options.primaryKey;
    this.nullable = !options.primaryKey && options.nullable;
    this.optional = !options.primaryKey && options.optional;
    Object.freeze(this);
  }
  primaryKey() {
    return new _SQLiteColumn(this.field, this.kind, {
      nullable: false,
      optional: false,
      primaryKey: true,
      array: this.array,
      fileRead: this.fileRead,
      format: this.format,
      name: this.name
    });
  }
  notNull() {
    return new _SQLiteColumn(this.field, this.kind, {
      nullable: false,
      optional: false,
      primaryKey: this.isPrimaryKey,
      array: this.array,
      fileRead: this.fileRead,
      format: this.format,
      name: this.name
    });
  }
  from(file) {
    if (this.array || this.kind !== "blob" && this.kind !== "text")
      throw new TypeError("Files require a BLOB column, parsed TEXT or a stored TEXT reference");
    return new _SQLiteColumn(this.field, this.kind, {
      nullable: this.nullable,
      optional: this.optional,
      primaryKey: this.isPrimaryKey,
      fileRead: new FileRead(this.field, file, this.fileRead?.parser),
      name: this.name
    });
  }
  parse(parser) {
    if (this.kind !== "text")
      throw new TypeError("Document parsing requires a TEXT column");
    if (this.fileRead === void 0)
      throw new TypeError("Select a source file before selecting a parser");
    return new _SQLiteColumn(this.field, this.kind, {
      nullable: this.nullable,
      optional: this.optional,
      primaryKey: this.isPrimaryKey,
      fileRead: new FileRead(this.field, this.fileRead.file, parser),
      name: this.name
    });
  }
  // This column as the table names it.
  named(name) {
    return new _SQLiteColumn(this.field, this.kind, {
      nullable: this.nullable,
      optional: this.optional,
      primaryKey: this.isPrimaryKey,
      array: this.array,
      fileRead: this.fileRead,
      format: this.format,
      name
    });
  }
  get quotedName() {
    return `"${this.name.replaceAll('"', '""')}"`;
  }
  // Original file bytes live in a chunk table; the column keeps the file's id.
  get storesFile() {
    return this.kind === "blob" && this.fileRead !== void 0;
  }
  get storageType() {
    if (this.array)
      return "TEXT";
    return this.storesFile ? "INTEGER" : storageTypes[this.kind];
  }
  // The column's type as readers see it in the catalog.
  get dataType() {
    if (this.storesFile)
      return "integer";
    return this.array ? `${this.#typeName}[]` : this.#typeName;
  }
  // The kind with the precision and scale its format declares, as SQL writes
  // them; a timestamp of milliseconds is the plain kind.
  get #typeName() {
    const { format } = this;
    switch (format?.name) {
      case "date-time":
        return format.precision === 3 ? this.kind : `${this.kind}(${format.precision})`;
      case "date-time-local":
      case "time-local":
        return `${this.kind}(${format.precision})`;
      case "decimal":
        return format.precision === void 0 ? this.kind : `${this.kind}(${[format.precision, format.scale ?? []].join(",")})`;
      default:
        return this.kind;
    }
  }
  get definition() {
    const check = this.array ? ` CHECK (json_valid(${this.quotedName}) AND json_type(${this.quotedName}) = 'array')` : canonical(this.kind, this.quotedName, this.format);
    return `${this.quotedName} ${this.storageType}${this.isPrimaryKey ? " PRIMARY KEY NOT NULL" : ""}${check}`;
  }
  encode(record) {
    if (record === null || typeof record !== "object" || Array.isArray(record))
      throw new TypeError(`Record is missing field ${JSON.stringify(this.field)}`);
    if (!Object.hasOwn(record, this.field)) {
      if (this.optional)
        return null;
      throw new TypeError(`Record is missing field ${JSON.stringify(this.field)}`);
    }
    const value = Reflect.get(record, this.field);
    if (value === null && this.nullable)
      return null;
    const { format } = this;
    if (this.array) {
      if (Array.isArray(value) && value.every((element) => this.#element(element)))
        return JSON.stringify(value);
      throw new TypeError(`Field ${JSON.stringify(this.field)} requires an array of ${this.kind}${this.nullable ? " or null" : " (not null)"}`);
    }
    if (format !== void 0) {
      if (typeof value === "string" && format.accepts(value)) {
        if (format.name === "int64")
          return BigInt(value);
        if (format.name === "base64")
          return Buffer.from(value, "base64");
        return value;
      }
      throw new TypeError(`Field ${JSON.stringify(this.field)} requires a canonical ${format.name} value${this.nullable ? " or null" : " (not null)"}`);
    }
    switch (this.kind) {
      case "text":
        if (typeof value === "string")
          return value;
        break;
      case "boolean":
        if (typeof value === "boolean")
          return Number(value);
        break;
      case "integer":
        if (typeof value === "bigint" && value >= -(2n ** 63n) && value < 2n ** 63n || typeof value === "number" && Number.isSafeInteger(value))
          return value;
        break;
      case "date":
        if (isCalendarDate(value))
          return value;
        break;
      case "timestamp":
        if (isTimestamp(value))
          return value;
        break;
      case "real":
        if (typeof value === "number" && Number.isFinite(value))
          return value;
        break;
      case "blob":
        if (this.storesFile) {
          if (typeof value === "number" && Number.isSafeInteger(value))
            return value;
        } else if (value instanceof Uint8Array)
          return value;
    }
    throw new TypeError(`Field ${JSON.stringify(this.field)} requires ${this.kind}${this.nullable ? " or null" : " (not null)"}`);
  }
  // Whether a JSON array element keeps this kind's value exactly.
  #element(value) {
    if (this.format !== void 0)
      return typeof value === "string" && this.format.accepts(value);
    switch (this.kind) {
      case "text":
        return typeof value === "string";
      case "boolean":
        return typeof value === "boolean";
      case "integer":
        return Number.isSafeInteger(value);
      case "real":
        return typeof value === "number" && Number.isFinite(value);
      case "date":
        return isCalendarDate(value);
      case "timestamp":
        return isTimestamp(value);
      default:
        return false;
    }
  }
};

// ../elt/packages/destinations/sqlite/dist/sqlite-columns.js
function scalarKind(name, type, format) {
  switch (type) {
    case "string":
      return format === null ? "text" : formatKinds[format.name];
    case "integer":
      return "integer";
    case "number":
      return "real";
    case "boolean":
      return "boolean";
    default:
      throw new TypeError(`Unsupported JSON Schema type for field ${name}: ${type}`);
  }
}
var SQLiteColumns = class {
  // Scalars, and arrays of scalars as JSON arrays in TEXT. String formats
  // keep their kind, as in Postgres.
  static fromSchema({ properties, required = [] }) {
    if (properties === void 0)
      throw new TypeError("SQLite requires an object schema with explicit properties");
    const requiredFields = new Set(required);
    for (const name of requiredFields)
      if (!Object.hasOwn(properties, name))
        throw new TypeError(`Schema does not describe field ${name}`);
    return Object.entries(properties).map(([name, field]) => {
      const types = typeof field.type === "string" ? [field.type] : field.type;
      if (new Set(types).size !== types.length)
        throw new TypeError(`Unsupported JSON Schema type for field ${name}`);
      const valueTypes = types.filter((type) => type !== "null");
      const valueType = valueTypes[0];
      if (valueType === void 0 || valueTypes.length !== 1)
        throw new TypeError(`SQLite requires one scalar type for field ${name}`);
      const array = valueType === "array";
      const items = array ? field.items : void 0;
      if (array && items === void 0)
        throw new TypeError(`Unsupported JSON Schema items for field ${name}`);
      const format = declaredFormat(items ?? field);
      return new SQLiteColumn(name, scalarKind(name, items?.type ?? valueType, format), {
        nullable: types.includes("null"),
        optional: !requiredFields.has(name),
        primaryKey: false,
        array,
        format: format ?? void 0
      });
    });
  }
  text(field) {
    return new SQLiteColumn(field, "text", {
      nullable: true,
      optional: false,
      primaryKey: false
    });
  }
  integer(field) {
    return new SQLiteColumn(field, "integer", {
      nullable: true,
      optional: false,
      primaryKey: false
    });
  }
  real(field) {
    return new SQLiteColumn(field, "real", {
      nullable: true,
      optional: false,
      primaryKey: false
    });
  }
  date(field) {
    return new SQLiteColumn(field, "date", {
      nullable: true,
      optional: false,
      primaryKey: false
    });
  }
  timestamp(field) {
    return new SQLiteColumn(field, "timestamp", {
      nullable: true,
      optional: false,
      primaryKey: false
    });
  }
  blob(field) {
    return new SQLiteColumn(field, "blob", {
      nullable: true,
      optional: false,
      primaryKey: false
    });
  }
  boolean(field) {
    return new SQLiteColumn(field, "boolean", {
      nullable: true,
      optional: false,
      primaryKey: false
    });
  }
};

// ../elt/packages/destinations/sqlite/dist/sqlite-destination.js
import { resolve as resolve3 } from "node:path";
import { DatabaseSync as DatabaseSync6 } from "node:sqlite";

// ../elt/packages/destinations/sqlite/dist/sqlite-writer.js
import { createHash as createHash3 } from "node:crypto";
import { DatabaseSync as DatabaseSync5 } from "node:sqlite";

// ../elt/packages/destinations/sqlite/dist/sqlite-file-store.js
import { createHash as createHash2 } from "node:crypto";
var quote3 = (name) => `"${name.replaceAll('"', '""')}"`;
var tablePrefix = "_elt_files_";
var chunks = '("file" INTEGER NOT NULL, "n" INTEGER NOT NULL, "bytes" BLOB NOT NULL, PRIMARY KEY ("file", "n")) STRICT';
var SQLiteFileStore = class _SQLiteFileStore {
  static chunkSize = 4 * 1024 * 1024;
  name;
  #database;
  #table;
  #column;
  #staged;
  constructor(database, table, column) {
    this.#database = database;
    this.#table = table;
    this.#column = column;
    this.name = _SQLiteFileStore.tableName(table, column);
    this.#staged = quote3(`${tablePrefix}stage_${this.name.slice(tablePrefix.length)}`);
  }
  // A hash of the table and column, as SQLite compares them: joined as text,
  // table a_b with column c and table a with column b_c would share chunks
  // and prune each other's.
  static tableName(table, column) {
    const key = createHash2("sha256").update(JSON.stringify([table.location, identifiers.key(column.name)])).digest("hex").slice(0, 40);
    return `${tablePrefix}${key}`;
  }
  #exists(location) {
    return this.#database.prepare(`SELECT 1 FROM sqlite_schema WHERE "type" = 'table' AND lower("name") = ?`).get(location) !== void 0;
  }
  get published() {
    return this.#exists(this.name);
  }
  stage() {
    this.#database.exec(`DROP TABLE IF EXISTS temp.${this.#staged}`);
    this.#database.exec(`CREATE TEMP TABLE ${this.#staged} ${chunks}`);
  }
  // An empty file still stores one empty chunk, so its id stays reserved. Ids
  // continue after both the published and the staged chunks.
  async save(content) {
    const highest = (table) => Number(this.#database.prepare(`SELECT coalesce(max("file"), 0) AS "file" FROM ${table}`).get()?.file);
    const file = Math.max(this.published ? highest(quote3(this.name)) : 0, highest(`temp.${this.#staged}`)) + 1;
    const insert = this.#database.prepare(`INSERT INTO temp.${this.#staged} ("file", "n", "bytes") VALUES (?, ?, ?)`);
    let n = 0;
    for await (const chunk of content.chunks(_SQLiteFileStore.chunkSize))
      insert.run(file, n++, chunk);
    if (n === 0)
      insert.run(file, 0, new Uint8Array());
    return file;
  }
  // Moves the staged chunks into the store, inside a commit, and attaches the
  // triggers to the target once it exists. A reload swaps in a table without
  // them, which its next commit attaches again.
  publish() {
    const table = quote3(this.name);
    const column = this.#column.quotedName;
    this.#database.exec(`CREATE TABLE IF NOT EXISTS ${table} ${chunks}`);
    if (this.#exists(this.#table.location)) {
      this.#database.exec(`CREATE TRIGGER IF NOT EXISTS ${quote3(`${this.name}_delete`)} AFTER DELETE ON ${this.#table.quotedName} BEGIN DELETE FROM ${table} WHERE "file" = old.${column}; END`);
      this.#database.exec(`CREATE TRIGGER IF NOT EXISTS ${quote3(`${this.name}_update`)} AFTER UPDATE OF ${column} ON ${this.#table.quotedName} WHEN old.${column} IS NOT new.${column} BEGIN DELETE FROM ${table} WHERE "file" = old.${column}; END`);
    }
    this.#database.exec(`INSERT INTO ${table} SELECT * FROM temp.${this.#staged}`);
    this.discard();
  }
  discard() {
    this.#database.exec(`DELETE FROM temp.${this.#staged}`);
  }
  unstage() {
    this.#database.exec(`DROP TABLE IF EXISTS temp.${this.#staged}`);
  }
};

// ../elt/packages/destinations/sqlite/dist/sqlite-writer.js
var quote4 = (name) => `"${name.replaceAll('"', '""')}"`;
var writersTable = new Declaration([
  'CREATE TABLE "_elt_writers" ("target" TEXT PRIMARY KEY, "writer" TEXT NOT NULL) STRICT'
], { rows: "replace" });
var seq = '"_elt_seq"';
var op = '"_elt_op"';
var SQLiteWriter = class extends Writer {
  configuration;
  path;
  table;
  #description;
  constructor(configuration, path, table) {
    super(configuration.stream);
    this.configuration = configuration;
    this.path = path;
    this.table = table;
    this.#description = describeTarget(configuration, table.columns, (column) => `Integer reference to the source file's original bytes. Join ${quote4(SQLiteFileStore.tableName(table, column))} on file = this value and concatenate bytes in order of n. NULL when the source file is unavailable.`);
    if (table.readerView === void 0)
      return;
    const { missing } = this.#description;
    if (missing.length > 0)
      throw new TypeError(`Reader view ${table.readerView} needs JSON Schema descriptions for ${missing.join(", ")} of stream ${this.stream.name}`);
  }
  // What the target needs at its first commit, before its first merge.
  // replacing: that commit replaces the target, so its rows are moot. A mode
  // without a key releases the index a deduplicating mode made.
  initialize(database, _replacing) {
    this.dropDedupIndexes(database, null);
  }
  // Drops the deduplication indexes this library made on the target, except
  // kept.
  dropDedupIndexes(database, kept) {
    for (const { name } of database.prepare(String.raw`SELECT "name" FROM sqlite_schema WHERE "type" = 'index' AND "tbl_name" = ? AND "name" LIKE '\_elt\_dedup\_%' ESCAPE '\'`).all(this.table.name))
      if (name !== kept)
        database.exec(`DROP INDEX ${quote4(String(name))}`);
  }
  // Refuses, before anything is read, stored rows the load cannot keep.
  inspect(_database) {
  }
  // What a reload's hidden target needs once it is created, before the first
  // merge fills it, and once it takes the target's name.
  build(_database, _into) {
  }
  adopt(_database) {
  }
  // Inserts each staged record, in order.
  append(database, stage, loadedAt, into) {
    database.prepare(`INSERT INTO ${into} (${this.fields.join(", ")}) SELECT ${this.table.columns.map((column) => column.quotedName).join(", ")}, ? FROM ${stage} WHERE ${op} = 'R' ORDER BY ${seq}`).run(loadedAt);
  }
  // An overwrite replaces the target at its first commit.
  get replaces() {
    return false;
  }
  // Empties the target a replacing commit is about to fill.
  replace(database) {
    database.exec(`DELETE FROM ${this.table.quotedName}`);
  }
  get hash() {
    return createHash3("sha256").update(this.table.location).digest("hex");
  }
  get fields() {
    return [
      ...this.table.columns.map((column) => column.quotedName),
      '"loaded_at"'
    ];
  }
  encode(record) {
    return this.table.columns.map((column) => column.encode(record));
  }
  // Only a load that identifies rows by key can remove one.
  deletionKeys(_key) {
    throw new TypeError("Only deduplicating loads can apply deletions");
  }
  // The owner lives beside the table it guards. A dropped table releases it,
  // since nothing it held remains, and so does a table of owners another
  // version declared otherwise, which is replaced empty.
  writers(database) {
    writersTable.apply(database);
  }
  // Refuses, before anything is read, a target another writer owns.
  #refuse(database, writer) {
    if (!this.exists(database, "_elt_writers"))
      return;
    const owner = database.prepare(`SELECT "writer" FROM "_elt_writers" WHERE "target" = ? AND "target" IN (SELECT lower("name") FROM sqlite_schema WHERE "type" = 'table')`).get(this.table.location)?.writer;
    if (owner !== void 0 && owner !== writer)
      throw new TargetOwnedError(this.table.name, String(owner), writer);
  }
  // Records the owner with the target's first commit; prepare refused any
  // other.
  own(database, writer) {
    this.writers(database);
    database.exec(`DELETE FROM "_elt_writers" WHERE "target" NOT IN (SELECT lower("name") FROM sqlite_schema WHERE "type" = 'table')`);
    database.prepare('INSERT INTO "_elt_writers" ("target", "writer") VALUES (?, ?) ON CONFLICT ("target") DO NOTHING').run(this.table.location, writer);
  }
  exists(database, location) {
    return database.prepare(`SELECT 1 FROM sqlite_schema WHERE "type" = 'table' AND lower("name") = ?`).get(location) !== void 0;
  }
  // The field's values in each of the tables, which while a reload is open
  // are the target and its hidden target: both rows still refer to files.
  values(database, tables2) {
    const { table } = this;
    return async function* (field) {
      const column = table.columns.find((column2) => column2.field === field);
      if (column === void 0)
        throw new TypeError(`Unknown target field: ${field}`);
      for (const name of tables2()) {
        if (!database.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ? COLLATE NOCASE").get(name, column.name))
          continue;
        for (const row of database.prepare(`SELECT ${column.quotedName} AS value FROM ${quote4(name)}`).iterate())
          yield row.value;
      }
    };
  }
  async clear(writer, committed) {
    var _stack = [];
    try {
      const database = __using(_stack, new DatabaseSync5(this.path, { timeout: 3e4 }));
      database.exec("BEGIN IMMEDIATE");
      try {
        this.writers(database);
        const owner = database.prepare('SELECT "writer" FROM "_elt_writers" WHERE "target" = ?').get(this.table.location)?.writer;
        if (owner !== void 0 && owner !== writer)
          throw new TargetOwnedError(this.table.name, String(owner), writer);
        if (this.exists(database, this.table.location)) {
          database.exec(`DELETE FROM ${this.table.quotedName}`);
          database.exec(`DROP TABLE IF EXISTS ${quote4(this.#hiddenName)}`);
          for (const column of this.table.columns) {
            const chunks2 = SQLiteFileStore.tableName(this.table, column);
            if (column.storesFile && this.exists(database, chunks2))
              database.exec(`DELETE FROM ${quote4(chunks2)}`);
          }
        }
        database.prepare('DELETE FROM "_elt_writers" WHERE "target" = ?').run(this.table.location);
        database.exec("COMMIT");
        database.exec("BEGIN IMMEDIATE");
        await committed?.(this.values(database, () => [this.table.name]));
        database.exec("ROLLBACK");
      } catch (error) {
        if (database.isTransaction)
          database.exec("ROLLBACK");
        throw error;
      }
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  // What the table, its reader view and their columns say to readers,
  // rewritten with every load so they follow the stream's schema.
  describe(database) {
    const dataTypes = new Map([
      ...this.table.columns.map(({ name, dataType }) => [name, dataType]),
      ["loaded_at", "timestamp"]
    ]);
    const columns2 = Object.fromEntries(Object.entries(this.#description.columns).map(([name, description]) => [
      name,
      { description, dataType: dataTypes.get(name) }
    ]));
    describe(database, this.table.name, this.#description.table, columns2);
    if (this.table.readerView !== void 0)
      describe(database, this.table.readerView, this.#description.table, columns2);
  }
  #viewDefinition(view) {
    return `CREATE VIEW ${quote4(view)} AS SELECT ${this.fields.join(", ")} FROM ${this.table.quotedName}`;
  }
  // Refuses, before anything is read, a view of other columns or another
  // table, rather than adopting it. A stale table's view still selects the
  // stored columns, which evolving the table replaces.
  #refuseReaderView(database, view, stale) {
    const existing = database.prepare('SELECT "type", "sql" FROM sqlite_schema WHERE lower("name") = lower(?)').get(view);
    if (existing === void 0)
      return;
    const sql = String(existing.sql);
    const ours = stale ? sql.startsWith(`CREATE VIEW ${quote4(view)} AS SELECT `) && sql.endsWith(` FROM ${this.table.quotedName}`) : sql === this.#viewDefinition(view);
    if (existing.type !== "view" || !ours)
      throw new TypeError(`${quote4(view)} is not a view of exactly ${this.table.quotedName}; drop it or delete the database`);
  }
  // Created only when absent and never replaced by a commit: replacing a view
  // readers can see would lock them out. prepare refused any view not this
  // load's own.
  installReaderView(database, view) {
    if (database.prepare('SELECT 1 FROM sqlite_schema WHERE lower("name") = lower(?)').get(view) === void 0)
      database.exec(this.#viewDefinition(view));
  }
  // The target as its first commit makes it: its owner, the table and the
  // index its mode owns, its reader view and its descriptions.
  #create(database, writer, replacing) {
    this.own(database, writer);
    database.exec(this.table.createTableSQL);
    this.initialize(database, replacing);
    if (this.table.readerView !== void 0)
      this.installReaderView(database, this.table.readerView);
    this.describe(database);
  }
  // The rows of one partition, or every row when the stream is not
  // partitioned, as a WHERE clause over the target's or the stage's columns.
  #scope(partition) {
    if (partition === null)
      return ["", []];
    const columns2 = Object.keys(partition).map((field) => {
      const column = this.table.columns.find((column2) => column2.field === field);
      if (column === void 0)
        throw new TypeError(`Resetting a partition requires destination column ${field}`);
      return column;
    });
    return [
      ` WHERE ${columns2.map((column) => `${column.quotedName} = ?`).join(" AND ")}`,
      columns2.map((column) => column.encode(partition))
    ];
  }
  // A reload's hidden target, beside the target and invisible to readers.
  get #hiddenName() {
    return `_elt_next_${this.hash}`;
  }
  // The table the stream needs under the name, by the text SQLite keeps of
  // its CREATE TABLE, which a CHECK alone can change. Evolving it keeps its
  // rows.
  #declaration(name) {
    return new Declaration([`CREATE TABLE ${this.table.definition(quote4(name))}`], { rows: "keep" });
  }
  // Drops the chunks of every stored column that is no longer one of the
  // target's file columns, and the triggers that delete them, before the table
  // is replaced: no row of the table that takes its place refers to them.
  #dropRetiredChunks(database) {
    const files = new Set(this.table.columns.filter(({ storesFile }) => storesFile).map(({ name }) => identifiers.key(name)));
    for (const { name } of database.prepare('SELECT "name" FROM pragma_table_info(?)').all(this.table.name))
      if (!files.has(identifiers.key(String(name)))) {
        const chunks2 = SQLiteFileStore.tableName(this.table, {
          name: String(name)
        });
        database.exec(`DROP TABLE IF EXISTS ${quote4(chunks2)}`);
        for (const trigger of ["delete", "update"])
          database.exec(`DROP TRIGGER IF EXISTS ${quote4(`${chunks2}_${trigger}`)}`);
      }
  }
  // Brings a stored table the stream no longer fits to its shape, keeping
  // every row: drift rebuilds it from the new definition and copies the
  // columns both have, by name, a column the stream added taking its default
  // (NULL) and one it dropped left behind. A value the new definition refuses
  // fails the load, naming the column, and the transaction leaves the table as
  // it was. The reader view selects the stored columns, and the mode index
  // can cover a dropped key, so both are made again for the new shape.
  #evolve(database) {
    if (this.table.readerView !== void 0)
      database.exec(`DROP VIEW IF EXISTS ${quote4(this.table.readerView)}`);
    this.dropDedupIndexes(database, null);
    this.#dropRetiredChunks(database);
    try {
      this.#declaration(this.table.name).apply(database);
    } catch (cause) {
      throw new TypeError(`The rows stored in ${this.table.quotedName} do not fit the new shape of stream ${this.stream.name}: ${cause instanceof Error ? cause.message : String(cause)}. Clear the copy to load it again, or change the stream so they fit.`, { cause });
    }
    this.initialize(database, false);
    if (this.table.readerView !== void 0)
      this.installReaderView(database, this.table.readerView);
    this.describe(database);
  }
  // Refuses, in one short transaction, a target another writer owns, a
  // reader view not its own and stored rows it cannot keep, evolves a stored
  // table the stream no longer fits unless the load overwrites it, and stages
  // in TEMP. Nothing else reaches the database until a commit. A load into the
  // target creates it, or adopts the stored one, at its first commit; a reload
  // leaves it to readers as it is, merges into a hidden target from its first
  // commit, and swaps that in at complete().
  prepare(database, { writer, reloading }, loadedAt) {
    const name = quote4(`_elt_stage_${this.hash}`);
    const stage = `temp.${name}`;
    const hidden = quote4(this.#hiddenName);
    const stores = this.table.columns.filter((column) => column.storesFile).map((column) => ({
      column,
      store: new SQLiteFileStore(database, this.table, column)
    }));
    let mode;
    const open2 = (at) => at === "reload" || at === "continue";
    const into = () => open2(mode) ? hidden : this.table.quotedName;
    const tables2 = () => [this.table.name, ...open2(mode) ? [this.#hiddenName] : []].filter((table) => this.exists(database, identifiers.key(table)));
    const referenced3 = (column) => tables2().map((table) => `SELECT ${column.quotedName} FROM ${quote4(table)} WHERE ${column.quotedName} IS NOT NULL`).join(" UNION ") || "SELECT NULL WHERE 0";
    const prune = () => {
      for (const { column, store } of stores)
        if (store.published)
          database.exec(`DELETE FROM ${quote4(store.name)} WHERE "file" NOT IN (${referenced3(column)})`);
    };
    mode = transaction(database, () => {
      this.#refuse(database, writer);
      const target = this.#declaration(this.table.name).drift(database);
      let next = reloadMode({
        reloading,
        destinationSyncMode: this.configuration.destinationSyncMode,
        target,
        hidden: this.#declaration(this.#hiddenName).drift(database)
      });
      if (next !== "continue")
        database.exec(`DROP TABLE IF EXISTS ${hidden}`);
      if (!open2(next) && this.table.readerView !== void 0)
        this.#refuseReaderView(database, this.table.readerView, target === "stale");
      if (next === "evolve") {
        this.#evolve(database);
        next = "load";
      }
      if (next === "load" && !this.replaces)
        this.inspect(database);
      database.exec(`DROP TABLE IF EXISTS ${stage}`);
      database.exec(`CREATE TEMP TABLE ${name} (${seq} INTEGER PRIMARY KEY, ${op} TEXT NOT NULL, ${this.table.columns.map((column) => `${column.quotedName} ${column.storageType}`).join(", ")})`);
      for (const { store } of stores)
        store.stage();
      return next;
    }, { mode: "immediate" });
    const fresh = mode === "create" || mode === "reload";
    let opened = mode === "continue";
    const columns2 = this.table.columns.map((column) => column.quotedName);
    const record = database.prepare(`INSERT INTO ${stage} (${op}, ${columns2.join(", ")}) VALUES ('R', ${columns2.map(() => "?").join(", ")})`);
    const staged = (column) => `SELECT ${column.quotedName} FROM ${stage} WHERE ${column.quotedName} IS NOT NULL`;
    let resets = [];
    const drop3 = () => {
      for (const { column, store } of stores) {
        if (store.published)
          database.exec(`DELETE FROM ${quote4(store.name)} WHERE "file" IN (${staged(column)}) AND "file" NOT IN (${referenced3(column)})`);
        store.discard();
      }
      database.exec(`DELETE FROM ${stage}`);
      resets = [];
    };
    let committed = false;
    return {
      fresh,
      get reloading() {
        return open2(mode);
      },
      values: this.values(database, tables2),
      apply: async (operation) => {
        if (operation.type === "RESET") {
          const { partition } = operation;
          if (partition === null) {
            drop3();
            mode = "reload";
            opened = false;
            return;
          }
          const [rows, values] = this.#scope(partition);
          database.prepare(`DELETE FROM ${stage}${rows}`).run(...values);
          resets.push(partition);
          return;
        }
        if (operation.type === "DELETE") {
          const [keys, values] = this.deletionKeys(operation.key);
          database.prepare(`INSERT INTO ${stage} (${op}, ${keys.map((column) => column.quotedName).join(", ")}) VALUES ('D', ${keys.map(() => "?").join(", ")})`).run(...values);
          return;
        }
        let data = operation.data;
        for (const { column, store } of stores) {
          const content = Reflect.get(Object(data), column.field);
          if (content instanceof FileContent)
            data = {
              ...Object(data),
              [column.field]: await store.save(content)
            };
        }
        record.run(...this.encode(data));
      },
      // Each commit is one transaction; a failed one leaves the database as
      // the last commit left it.
      commit: async () => {
        transaction(database, () => {
          if (open2(mode)) {
            if (!opened) {
              database.exec(`DROP TABLE IF EXISTS ${hidden}`);
              database.exec(`CREATE TABLE ${this.table.definition(hidden)}`);
              this.build(database, hidden);
            }
            if (!committed)
              this.own(database, writer);
          } else if (!committed) {
            this.#create(database, writer, this.replaces);
            if (this.replaces)
              this.replace(database);
          }
          for (const partition of resets) {
            const [rows, values] = this.#scope(partition);
            database.prepare(`DELETE FROM ${into()}${rows}`).run(...values);
          }
          for (const { store } of stores)
            store.publish();
          this.merge(database, stage, loadedAt, into());
          if (resets.length > 0)
            prune();
          drop3();
        }, { mode: "immediate" });
        opened = open2(mode);
        committed = true;
      },
      complete: async () => {
        if (!open2(mode))
          return;
        transaction(database, () => {
          if (this.table.readerView !== void 0)
            database.exec(`DROP VIEW IF EXISTS ${quote4(this.table.readerView)}`);
          this.#dropRetiredChunks(database);
          database.exec(`DROP TABLE IF EXISTS ${this.table.quotedName}`);
          database.exec(`ALTER TABLE ${hidden} RENAME TO ${this.table.quotedName}`);
          this.adopt(database);
          if (this.table.readerView !== void 0)
            this.installReaderView(database, this.table.readerView);
          this.describe(database);
          mode = "load";
          prune();
        }, { mode: "immediate" });
        opened = false;
      },
      discard: async () => drop3(),
      [Symbol.asyncDispose]: async () => {
        drop3();
        database.exec(`DROP TABLE ${stage}`);
        for (const { store } of stores)
          store.unstage();
      }
    };
  }
};

// ../elt/packages/destinations/sqlite/dist/sqlite-append-writer.js
var SQLiteAppendWriter = class extends SQLiteWriter {
  constructor(configuration, path, table) {
    super(configuration, path, table);
    Object.freeze(this);
  }
  merge(database, stage, loadedAt, into) {
    this.append(database, stage, loadedAt, into);
  }
};

// ../elt/packages/destinations/sqlite/dist/sqlite-deduplicating-writer.js
import { createHash as createHash4 } from "node:crypto";
var SQLiteDeduplicatingWriter = class extends SQLiteWriter {
  deduplication;
  keys;
  cursor;
  constructor(configuration, path, table) {
    super(configuration, path, table);
    this.deduplication = configuration.deduplication();
    const inferred = SQLiteColumns.fromSchema(configuration.stream.jsonSchema);
    const column = (field) => {
      const selected = table.columns.find((column2) => column2.field === field);
      if (selected === void 0)
        throw new TypeError(`Deduplication requires destination column ${field}`);
      if (selected.dataType !== inferred.find((column2) => column2.field === field)?.dataType)
        throw new TypeError(`Deduplication column ${field} must preserve the source scalar type`);
      return selected;
    };
    this.keys = Object.freeze(this.deduplication.primaryKey.map(column));
    const { cursorField } = this.deduplication;
    this.cursor = cursorField === void 0 ? void 0 : column(cursorField);
    Object.freeze(this);
  }
  get replaces() {
    return this.configuration.destinationSyncMode === "overwrite_dedup";
  }
  // Named after the table and its key, so a changed key builds a new index
  // and an unchanged one is never rebuilt.
  get #dedupIndex() {
    return `_elt_dedup_${createHash4("sha256").update(JSON.stringify([this.table.name, this.keys.map((key) => key.name)])).digest("hex")}`;
  }
  // A stored table the load merges into must hold keys and cursors of the
  // stream's types, none null, and no key twice, which its index forbids once
  // it exists.
  inspect(database) {
    const existing = database.prepare(`PRAGMA table_info(${this.table.quotedName})`).all();
    const tracked = this.cursor === void 0 ? this.keys : [...this.keys, this.cursor];
    for (const column of tracked) {
      if (!existing.some((field) => field.name === column.name && field.type === column.storageType))
        throw new TypeError(`Existing deduplication column ${column.name} has an incompatible storage type`);
    }
    if (database.prepare(`SELECT 1 FROM ${this.table.quotedName} WHERE ${tracked.map((column) => `${column.quotedName} IS NULL`).join(" OR ")} LIMIT 1`).get())
      throw new TypeError("Existing deduplication keys and cursors must be non-null");
    if (database.prepare(`SELECT 1 FROM sqlite_schema WHERE "type" = 'index' AND "name" = ?`).get(this.#dedupIndex) === void 0 && database.prepare(`SELECT 1 FROM ${this.table.quotedName} GROUP BY ${this.keys.map((column) => `${column.quotedName} COLLATE BINARY`).join(", ")} HAVING count(*) > 1 LIMIT 1`).get())
      throw new TypeError("Existing rows repeat a deduplication key; replace them with overwrite_dedup before deduplicating incrementally");
  }
  // A replacing load keeps none of the stored rows: its index is built once
  // the commit has emptied the table.
  initialize(database, replacing) {
    if (replacing)
      this.dropDedupIndexes(database, this.#dedupIndex);
    else
      this.#index(database);
  }
  replace(database) {
    super.replace(database);
    this.#index(database);
  }
  // The target's key index, built only when it does not exist yet.
  #index(database) {
    this.dropDedupIndexes(database, this.#dedupIndex);
    this.#unique(database, `"${this.#dedupIndex}"`, this.table.quotedName);
  }
  #unique(database, name, on) {
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${on} (${this.keys.map((column) => `${column.quotedName} COLLATE BINARY`).join(", ")})`);
  }
  // A reload's hidden target merges on its key from its first commit; SQLite
  // cannot rename an index, so the target's own is built once it is swapped in.
  get #provisionalIndex() {
    return `"${this.#dedupIndex}_next"`;
  }
  build(database, into) {
    this.#unique(database, this.#provisionalIndex, into);
  }
  adopt(database) {
    database.exec(`DROP INDEX IF EXISTS ${this.#provisionalIndex}`);
    this.#index(database);
  }
  // The result of applying the staged operations one at a time: a staged
  // DELETE removes its key, and only records after a key's last DELETE count.
  // replace keeps the newest extraction, so a restated fact overwrites the
  // loaded one; cursor_newer keeps the greatest cursor (the first on ties) and
  // the guard that rejects out-of-order replay.
  merge(database, stage, loadedAt, into) {
    const keys = this.keys.map((column) => column.quotedName);
    const same = (left, right) => keys.map((key) => `${left}.${key} = ${right}.${key}`).join(" AND ");
    database.exec(`DELETE FROM ${into} WHERE (${keys.join(", ")}) IN (SELECT ${keys.join(", ")} FROM ${stage} WHERE ${op} = 'D')`);
    const { cursor } = this;
    const guarded = this.configuration.dedupPolicy !== "replace" && cursor !== void 0;
    const order = guarded ? `"staged".${cursor.quotedName} COLLATE BINARY DESC, "staged".${seq}` : `"staged".${seq} DESC`;
    const columns2 = this.table.columns.map((column) => column.quotedName);
    database.prepare(`WITH "deleted" AS (SELECT ${keys.join(", ")}, max(${seq}) AS "_elt_last" FROM ${stage} WHERE ${op} = 'D' GROUP BY ${keys.join(", ")}), "ranked" AS (SELECT "staged".${seq}, row_number() OVER (PARTITION BY ${keys.map((key) => `"staged".${key}`).join(", ")} ORDER BY ${order}) AS "_elt_rank" FROM ${stage} AS "staged" LEFT JOIN "deleted" ON ${same('"deleted"', '"staged"')} WHERE "staged".${op} = 'R' AND ("deleted"."_elt_last" IS NULL OR "staged".${seq} > "deleted"."_elt_last")) INSERT INTO ${into} AS "_elt_target" (${this.fields.join(", ")}) SELECT ${columns2.join(", ")}, ? FROM ${stage} WHERE ${seq} IN (SELECT ${seq} FROM "ranked" WHERE "_elt_rank" = 1) ORDER BY ${seq} ON CONFLICT (${keys.map((key) => `${key} COLLATE BINARY`).join(", ")}) DO UPDATE SET ${this.fields.map((field) => `${field} = excluded.${field}`).join(", ")}${guarded ? ` WHERE excluded.${cursor.quotedName} COLLATE BINARY > "_elt_target".${cursor.quotedName}` : ""}`).run(loadedAt);
  }
  encode(record) {
    this.deduplication.key(record);
    if (this.cursor !== void 0)
      this.deduplication.cursor(record);
    return super.encode(record);
  }
  deletionKeys(key) {
    this.deduplication.key(key);
    return [this.keys, this.keys.map((column) => column.encode(key))];
  }
};

// ../elt/packages/destinations/sqlite/dist/sqlite-overwrite-writer.js
var SQLiteOverwriteWriter = class extends SQLiteWriter {
  constructor(configuration, path, table) {
    super(configuration, path, table);
    Object.freeze(this);
  }
  get replaces() {
    return true;
  }
  merge(database, stage, loadedAt, into) {
    this.append(database, stage, loadedAt, into);
  }
};

// ../elt/packages/destinations/sqlite/dist/sqlite-table.js
var SQLiteTable = class _SQLiteTable extends Target {
  name;
  columns;
  // The name readers query: a documented view of exactly this table.
  readerView;
  constructor(name, columns2, readerView) {
    if (typeof name !== "string" || readerView !== void 0 && typeof readerView !== "string")
      throw new TypeError("A table and its view are named by strings");
    const table = identifiers.relation(name);
    const view = readerView === void 0 ? void 0 : identifiers.relation(readerView);
    if (view !== void 0 && identifiers.key(view) === identifiers.key(table))
      throw new TypeError("A reader view needs a name of its own");
    if (columns2 !== void 0 && (!Array.isArray(columns2) || columns2.length === 0 || !columns2.every((column) => column instanceof SQLiteColumn)))
      throw new TypeError("A table requires at least one SQLite column");
    const fields = (columns2 ?? []).map((column) => column.field);
    if (new Set(fields).size !== fields.length)
      throw new TypeError("Two columns hold one field");
    if ((columns2 ?? []).filter((column) => column.isPrimaryKey).length > 1)
      throw new TypeError("Only one primary-key column is supported");
    const fileReads = (columns2 ?? []).flatMap((column) => column.fileRead === void 0 ? [] : [column.fileRead]);
    for (const column of columns2 ?? []) {
      if (column.fileRead === void 0)
        continue;
      if (column.fileRead.outputType === "bytes" ? column.kind !== "blob" : column.kind !== "text")
        throw new TypeError("Original files require a BLOB column; parsed text and stored references require a TEXT column");
    }
    super(fileReads);
    this.name = table;
    this.columns = Object.freeze(identifiers.columns(columns2 ?? []).map(([column, stored3]) => column.named(stored3)));
    this.readerView = view;
    Object.freeze(this);
  }
  // Loads also keep a view of this table under another name, created with the
  // table and described by the same descriptions, which every column then needs.
  withReaderView(name) {
    return new _SQLiteTable(this.name, this.columns.length === 0 ? void 0 : this.columns, name);
  }
  resolve(stream) {
    if (this.columns.length === 0)
      return new _SQLiteTable(this.name, SQLiteColumns.fromSchema(stream.jsonSchema), this.readerView);
    const { properties } = stream.jsonSchema;
    if (properties === void 0)
      return this;
    for (const column of this.columns)
      if (column.fileRead === void 0 && !Object.hasOwn(properties, column.field))
        throw new TypeError(`Stream ${stream.name} does not describe field ${column.field}`);
    return this;
  }
  // SQLite takes names that differ only in ASCII case for one, so one table
  // has one location.
  get location() {
    return identifiers.key(this.name);
  }
  get quotedName() {
    return `"${this.name.replaceAll('"', '""')}"`;
  }
  get createTableSQL() {
    return `CREATE TABLE IF NOT EXISTS ${this.definition(this.quotedName)}`;
  }
  // A table named name with these columns, as CREATE TABLE spells it.
  definition(name) {
    if (this.columns.length === 0)
      throw new TypeError("Resolve inferred columns before creating a table");
    return `${name} (${this.columns.map((column) => column.definition).join(", ")}, "loaded_at" TEXT NOT NULL${canonical("timestamp", '"loaded_at"')}) STRICT`;
  }
};

// ../elt/packages/destinations/sqlite/dist/sqlite-destination.js
var SQLiteDestination = class extends Destination {
  supportedDestinationSyncModes = Object.freeze([
    "overwrite",
    "append",
    "append_dedup",
    "overwrite_dedup"
  ]);
  path;
  constructor({ path }) {
    super();
    if (!path)
      throw new TypeError("SQLite requires a database path");
    this.path = path === ":memory:" ? path : resolve3(path);
    Object.freeze(this);
  }
  location(target) {
    return target.location;
  }
  // Each stream's commit is its own short transaction, so no transaction
  // stays open while the sources read.
  async load() {
    const database = new DatabaseSync6(this.path, { timeout: 3e4 });
    const loadedAt = (/* @__PURE__ */ new Date()).toISOString();
    return {
      prepare: async (configuration, target, binding) => this.createWriter(configuration, target).prepare(database, binding, loadedAt),
      [Symbol.asyncDispose]: async () => {
        try {
          if (database.isTransaction)
            database.exec("ROLLBACK");
        } finally {
          database.close();
        }
      }
    };
  }
  table(name, configure) {
    return new SQLiteTable(name, configure?.(new SQLiteColumns()));
  }
  createWriter(configuration, target) {
    this.validateConfiguration(configuration, target);
    if (!(target instanceof SQLiteTable))
      throw new TypeError("SQLite requires SQLite table targets");
    if (configuration.syncMode === "incremental" && this.path === ":memory:")
      throw new TypeError("Incremental SQLite requires a persistent destination file");
    const table = target.resolve(configuration.stream);
    switch (configuration.destinationSyncMode) {
      case "append_dedup":
      case "overwrite_dedup":
        return new SQLiteDeduplicatingWriter(configuration, this.path, table);
      case "append":
        return new SQLiteAppendWriter(configuration, this.path, table);
      case "overwrite":
        return new SQLiteOverwriteWriter(configuration, this.path, table);
      default:
        throw new TypeError(`Destination does not support ${configuration.destinationSyncMode}`);
    }
  }
};

// ../elt/packages/destinations/sqlite/dist/sqlite-passes.js
import { existsSync as existsSync2 } from "node:fs";
import { DatabaseSync as DatabaseSync7 } from "node:sqlite";

// ../elt/packages/destinations/sqlite/dist/sqlite-sync-history-schema.js
var attempts = '"_elt_sync_attempts"';
var coverage = '"_elt_extraction_coverage"';
var checks = '"_elt_stream_checks"';
var now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
var status = `"status" TEXT NOT NULL DEFAULT 'running' CHECK ("status" IN ('running', 'succeeded', 'partial', 'failed', 'cancelled'))`;
var tables = [
  `CREATE TABLE ${attempts} (
    "id" INTEGER PRIMARY KEY,
    "connector" TEXT NOT NULL CHECK (trim("connector") <> ''), "source" TEXT NOT NULL,
    "started_at" TEXT NOT NULL, "completed_at" TEXT, ${status}, "error" TEXT,
    "failure_type" TEXT CHECK ("failure_type" IN ('config', 'system')),
    CHECK (("status" = 'running') = ("completed_at" IS NULL)),
    CHECK (("status" IN ('partial', 'failed')) = ("failure_type" IS NOT NULL))
  ) STRICT`,
  `CREATE INDEX "_elt_sync_attempts_connector" ON ${attempts} ("connector", "id" DESC)`,
  `CREATE TABLE ${coverage} (
    "attempt_id" INTEGER NOT NULL REFERENCES ${attempts}("id"),
    "stream" TEXT NOT NULL, "target_schema" TEXT NOT NULL, "target_table" TEXT NOT NULL,
    "sync_mode" TEXT NOT NULL, "destination_sync_mode" TEXT NOT NULL,
    "description" TEXT NOT NULL CHECK (trim("description") <> ''),
    "selection" TEXT NOT NULL CHECK (json_valid("selection")), ${status},
    "written_count" INTEGER CHECK ("written_count" >= 0),
    "deleted_count" INTEGER CHECK ("deleted_count" >= 0),
    "failures" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("failures")),
    "upstream_current_as_of" TEXT,
    PRIMARY KEY ("attempt_id", "stream")
  ) STRICT`,
  // Each stream's latest check by a watch that found it unchanged.
  `CREATE TABLE ${checks} (
    "connector" TEXT NOT NULL, "stream" TEXT NOT NULL, "checked_at" TEXT NOT NULL,
    PRIMARY KEY ("connector", "stream")
  ) STRICT`
];
var syncHistoryTables = new Declaration(tables, { rows: "replace" });
var currency = `"stream_success" AS (
        SELECT a."connector", c."stream", min(a."started_at", coalesce(c."upstream_current_as_of", a."started_at")) AS "current_as_of",
          row_number() OVER (PARTITION BY a."connector", c."stream" ORDER BY a."completed_at" DESC, a."id" DESC) AS "rank"
        FROM ${coverage} c JOIN ${attempts} a ON a."id" = c."attempt_id" WHERE c."status" = 'succeeded'
      ), "currency" AS (
        SELECT d."connector", d."stream",
          CASE WHEN s."current_as_of" IS NULL THEN NULL ELSE max(s."current_as_of", coalesce(k."checked_at", s."current_as_of")) END AS "current_as_of"
        FROM (SELECT DISTINCT a."connector", c."stream" FROM ${coverage} c JOIN ${attempts} a ON a."id" = c."attempt_id") d
        LEFT JOIN "stream_success" s ON s."connector" = d."connector" AND s."stream" = d."stream" AND s."rank" = 1
        LEFT JOIN ${checks} k ON k."connector" = d."connector" AND k."stream" = d."stream"
      )`;
var queries = {
  sync_attempts: `SELECT "id" AS "attempt_id", "connector", "source", "started_at", "completed_at", "status", "error", "failure_type" FROM ${attempts}`,
  extraction_coverage: `SELECT c."attempt_id", a."connector", a."source", a."started_at", a."completed_at",
      c."stream", c."target_schema", c."target_table",
      EXISTS (SELECT 1 FROM sqlite_schema t WHERE t."type" = 'table' AND lower(t."name") = lower(c."target_table")) AS "target_exists",
      c."sync_mode", c."destination_sync_mode", c."description", c."selection",
      c."status", c."written_count", c."deleted_count", c."failures"
      FROM ${coverage} c JOIN ${attempts} a ON a."id" = c."attempt_id"`,
  sync_status: `WITH ${currency}, "success" AS (
        SELECT "connector", "id", "completed_at", row_number() OVER (PARTITION BY "connector" ORDER BY "completed_at" DESC, "id" DESC) AS "rank"
        FROM ${attempts} WHERE "status" = 'succeeded'
      ), "latest" AS (
        SELECT *, row_number() OVER (PARTITION BY "connector" ORDER BY "id" DESC) AS "rank" FROM ${attempts}
      )
      SELECT a."connector", a."id" AS "latest_attempt_id", a."started_at", a."completed_at", a."status", a."error", a."failure_type",
        s."id" AS "last_successful_attempt_id", s."completed_at" AS "last_successful_sync_at",
        (SELECT CASE WHEN count(*) = count(c."current_as_of") THEN min(c."current_as_of") END FROM "currency" c WHERE c."connector" = a."connector") AS "current_as_of"
      FROM "latest" a LEFT JOIN "success" s ON s."connector" = a."connector" AND s."rank" = 1
      WHERE a."rank" = 1 ORDER BY a."connector"`,
  stream_status: `WITH ${currency}, "declared" AS (
        SELECT a."connector", c."stream", c."target_schema", c."target_table", a."id", a."started_at", a."completed_at", c."status",
          row_number() OVER (PARTITION BY a."connector", c."stream" ORDER BY a."id" DESC) AS "rank"
        FROM ${coverage} c JOIN ${attempts} a ON a."id" = c."attempt_id"
      ), "success" AS (
        SELECT a."connector", c."stream", a."id", a."completed_at",
          row_number() OVER (PARTITION BY a."connector", c."stream" ORDER BY a."completed_at" DESC, a."id" DESC) AS "rank"
        FROM ${coverage} c JOIN ${attempts} a ON a."id" = c."attempt_id" WHERE c."status" = 'succeeded'
      )
      SELECT d."connector", d."stream", d."target_schema", d."target_table",
        d."id" AS "latest_attempt_id", d."started_at", d."completed_at", d."status",
        s."id" AS "last_successful_attempt_id", s."completed_at" AS "last_successful_sync_at", c."current_as_of"
      FROM "declared" d LEFT JOIN "success" s ON s."connector" = d."connector" AND s."stream" = d."stream" AND s."rank" = 1
      LEFT JOIN "currency" c ON c."connector" = d."connector" AND c."stream" = d."stream"
      WHERE d."rank" = 1 ORDER BY d."connector", d."stream"`
};
var syncHistoryViews = Object.values(syncHistoryRelations).map((relation) => ({ ...relation, query: queries[relation.name] }));
var syncHistory = new Declaration([...tables, ...syncHistoryViews.map(viewDefinition)], { rows: "replace" });

// ../elt/packages/destinations/sqlite/dist/sqlite-passes.js
var busyTimeout = 3e4;
function readSQLite(path) {
  if (existsSync2(path)) {
    var _stack = [];
    try {
      const recovery = __using(_stack, new DatabaseSync7(path, { timeout: busyTimeout }));
      recovery.prepare("SELECT count(*) FROM sqlite_schema").get();
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  return new DatabaseSync7(path, { readOnly: true, timeout: busyTimeout });
}
function readPassStatus(path) {
  var _stack = [];
  try {
    if (!existsSync2(path))
      return { pass: null, streams: [] };
    const data = __using(_stack, readSQLite(path));
    if (syncHistory.drift(data) !== "fits")
      return { pass: null, streams: [] };
    const latest = data.prepare("SELECT status, started_at, completed_at, error, failure_type, last_successful_sync_at, current_as_of FROM sync_status").get();
    return {
      pass: latest === void 0 ? null : recorded(latest, passState(latest.status)),
      streams: data.prepare("SELECT stream, status, last_successful_sync_at, current_as_of FROM stream_status ORDER BY stream").all().map((row) => ({
        stream: String(row.stream),
        state: passState(row.status),
        lastSucceededAt: text2(row.last_successful_sync_at),
        currentAsOf: text2(row.current_as_of)
      }))
    };
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    __callDispose(_stack, _error, _hasError);
  }
}
function recorded(row, state) {
  const started = {
    startedAt: String(row.started_at),
    lastSucceededAt: text2(row.last_successful_sync_at),
    currentAsOf: text2(row.current_as_of)
  };
  switch (state) {
    case "running":
      return {
        ...started,
        state,
        completedAt: null,
        error: null,
        failureType: null
      };
    case "succeeded":
      return {
        ...started,
        state,
        completedAt: String(row.completed_at),
        error: null,
        failureType: null
      };
    case "cancelled":
      return {
        ...started,
        state,
        completedAt: String(row.completed_at),
        error: String(row.error),
        failureType: null
      };
    default:
      return {
        ...started,
        state,
        completedAt: String(row.completed_at),
        error: String(row.error),
        failureType: failureType(row.failure_type)
      };
  }
}
function failureType(value) {
  switch (value) {
    case "config":
    case "system":
      return value;
    default:
      throw new TypeError(`Unknown failure type ${String(value)}`);
  }
}
function passState(status2) {
  switch (status2) {
    case "running":
    case "succeeded":
    case "partial":
    case "failed":
    case "cancelled":
      return status2;
    default:
      throw new TypeError(`Unknown pass status ${String(status2)}`);
  }
}
function text2(value) {
  if (value === void 0)
    throw new TypeError("A sync history view lacks a column it declares");
  return value === null ? null : String(value);
}

// ../elt/packages/destinations/sqlite/dist/sqlite-sync-history.js
import { DatabaseSync as DatabaseSync8 } from "node:sqlite";
var busyTimeout2 = 3e4;
var SQLiteSyncHistory = class extends SyncHistory {
  constructor() {
    super();
    Object.freeze(this);
  }
  validate(connection) {
    this.#path(connection);
  }
  async recordChecks(connection, streamChecks) {
    write(this.#path(connection), (database) => {
      const check = database.prepare(`INSERT INTO ${checks} ("connector", "stream", "checked_at") VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET "checked_at" = excluded."checked_at"`);
      for (const { stream, at } of streamChecks)
        check.run(connection.name, stream, at.toISOString());
    });
  }
  // Every selected stream is declared before reading, even if it produces no
  // rows or the process dies: an unfinished attempt stays running, never success.
  async begin(connection, copies) {
    const path = this.#path(connection);
    const id = write(path, (database) => {
      const attempt = database.prepare(`INSERT INTO ${attempts} ("connector", "source", "started_at") VALUES (?, ?, ${now}) RETURNING "id"`).get(connection.name, connection.source.identity);
      if (attempt === void 0)
        throw new Error("Sync attempt was not recorded");
      const id2 = Number(attempt.id);
      const declare = database.prepare(`INSERT INTO ${coverage} ("attempt_id", "stream", "target_schema", "target_table", "sync_mode", "destination_sync_mode", "description", "selection") VALUES (?, ?, 'main', ?, ?, ?, ?, ?)`);
      for (const { copy, coverage: coverage2 } of copies)
        declare.run(id2, copy.from.name, copy.to.name, copy.configuration.syncMode, copy.configuration.destinationSyncMode, coverage2.description, JSON.stringify(coverage2.selection));
      return id2;
    });
    return {
      finish: async (outcomes, upstream) => this.#finish(path, id, outcomes, upstream),
      fail: async (error, failureType2) => write(path, (database) => fail(database, id, error, failureType2))
    };
  }
  // Records every pass of connection that began and never ended as failed:
  // the process running it ended first, so no outcome will come. As Airbyte
  // fails a connection's unfinished jobs before it starts the next, only a
  // caller that knows no other process runs a pass of connection calls it,
  // such as the leader of the connection's flight; a pass still running
  // would read failed until it records how it ended.
  async failUnfinished(connection) {
    const error = new Error("The process running this pass ended before the pass did");
    write(this.#path(connection), (database) => {
      const unfinished = database.prepare(`SELECT "id" FROM ${attempts} WHERE "connector" = ? AND "status" = 'running'`).all(connection.name);
      for (const { id } of unfinished)
        fail(database, Number(id), error, "system");
    });
  }
  // Brings the history's tables to their declaration and publishes its views
  // in each file; safe to repeat. Tables another version declared otherwise
  // are replaced, and their history with them.
  async install(destinations) {
    for (const destination of destinations)
      write(persistent(destination), (database) => {
        syncHistoryTables.apply(database);
        publishSQLiteViews(database, { views: syncHistoryViews });
      });
  }
  #path({ name, destination }) {
    if (!(destination instanceof SQLiteDestination))
      throw new TypeError(`Connection ${name}: SQLite sync history records SQLite destinations only`);
    return persistent(destination);
  }
  #finish(path, id, outcomes, upstream) {
    write(path, (database) => {
      const record = database.prepare(`UPDATE ${coverage} SET "status" = ?, "written_count" = ?, "deleted_count" = ?, "failures" = ? WHERE "attempt_id" = ? AND "stream" = ?`);
      for (const outcome of outcomes)
        record.run(copyStatus(outcome), outcome.count, outcome.deleted, JSON.stringify(outcome.failures.map(recordedFailure)), id, outcome.copy.from.name);
      const bound = database.prepare(`UPDATE ${coverage} SET "upstream_current_as_of" = ? WHERE "attempt_id" = ? AND "stream" = ?`);
      for (const [stream, at] of upstream)
        bound.run(at.toISOString(), id, stream);
      database.prepare(`UPDATE ${attempts} SET "completed_at" = ${now}, "status" = ?, "error" = ?, "failure_type" = ? WHERE "id" = ?`).run(passStatus(outcomes), passError(outcomes), passFailureType(outcomes), id);
    });
  }
};
function fail(database, id, error, failureType2) {
  database.prepare(`UPDATE ${coverage} SET "status" = 'failed', "failures" = ? WHERE "attempt_id" = ?`).run(JSON.stringify([
    recordedFailure({ partition: null, error, failureType: failureType2 })
  ]), id);
  database.prepare(`UPDATE ${attempts} SET "status" = 'failed', "completed_at" = ${now}, "error" = ?, "failure_type" = ? WHERE "id" = ?`).run(message(error), failureType2, id);
}
function persistent({ path }) {
  if (path === ":memory:")
    throw new TypeError("SQLite sync history requires a destination file");
  return path;
}
function write(path, work) {
  var _stack = [];
  try {
    const database = __using(_stack, new DatabaseSync8(path, { timeout: busyTimeout2 }));
    return transaction(database, () => work(database), { mode: "immediate" });
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    __callDispose(_stack, _error, _hasError);
  }
}
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/settings/dist/settings.js
import { createHash as createHash5 } from "node:crypto";
import { chmodSync as chmodSync2, mkdirSync, readdirSync } from "node:fs";
import { join as join4 } from "node:path";
import { DatabaseSync as DatabaseSync10 } from "node:sqlite";

// node_modules/@zukhruf/sqlite-drift/dist/declaration.js
import { randomUUID as randomUUID4 } from "node:crypto";
import { DatabaseSync as DatabaseSync9 } from "node:sqlite";

// node_modules/@zukhruf/sqlite-drift/node_modules/@zukhruf/sqlite-transaction/dist/transaction.js
var SAVEPOINT3 = "zukhruf_transaction";
function transaction3(database, work, options) {
  const owns = !database.isTransaction;
  database.exec(owns ? `BEGIN ${options.mode.toUpperCase()}` : `SAVEPOINT ${SAVEPOINT3}`);
  try {
    const result = work();
    if (thenable3(result))
      throw new TypeError("A transaction function cannot return a promise");
    database.exec(owns ? "COMMIT" : `RELEASE ${SAVEPOINT3}`);
    return result;
  } catch (error) {
    if (database.isTransaction)
      database.exec(owns ? "ROLLBACK" : `ROLLBACK TO ${SAVEPOINT3}; RELEASE ${SAVEPOINT3}`);
    throw error;
  }
}
function thenable3(value) {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

// node_modules/@zukhruf/sqlite-drift/dist/declaration.js
var Declaration2 = class {
  #objects;
  #rows;
  constructor(statements, options) {
    var _stack = [];
    try {
      const blank = __using(_stack, new DatabaseSync9(":memory:"));
      for (const statement of statements)
        blank.exec(statement);
      this.#objects = blank.prepare('SELECT "type", "name", "sql" FROM sqlite_schema WHERE "sql" IS NOT NULL ORDER BY rowid').all().map(({ type, name, sql }) => ({
        type: String(type),
        name: String(name),
        sql: String(sql)
      }));
      this.#rows = options.rows;
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  drift(database) {
    const pairs = this.#objects.map((object) => ({
      object,
      found: stored2(database, object.name)
    }));
    if (pairs.every(({ found }) => found === void 0))
      return "missing";
    return pairs.every(({ object, found }) => found?.sql === object.sql) ? "fits" : "stale";
  }
  // Creates the objects the database does not store. When any stored object
  // differs from its declaration, rows 'replace' replaces every object of the
  // declaration, with its rows: a table can refer to another, and SQLite drops
  // a table only after nothing refers to its rows. Rows 'keep' makes each stale
  // object again, and moves the rows of a stale table into the new one (ADR
  // 0003). Works inside the caller's transaction, or in a write of its own.
  // Objects the declaration does not name stay.
  apply(database) {
    if (this.drift(database) === "fits")
      return;
    const unchecked = this.#rows === "keep" && Number(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys) === 1 && this.#stale(database).some(({ object, found }) => object.type === "table" && found.type === "table" && referenced2(database, found.name));
    if (unchecked) {
      if (database.isTransaction)
        throw new Error("Keeping the rows of a table that other tables reference needs foreign keys off, which SQLite cannot change inside a transaction. Call apply outside a transaction, or turn foreign keys off before it.");
      database.exec("PRAGMA foreign_keys = OFF");
    }
    try {
      transaction3(database, () => {
        const stale = this.#stale(database);
        if (this.#rows === "keep") {
          const views = compiled2(database);
          const rebuilt = this.#keep(database, stale);
          this.#create(database);
          verify2(database, rebuilt, views);
        } else {
          if (stale.length > 0)
            for (const object of this.#objects.toReversed()) {
              const found = stored2(database, object.name);
              if (found !== void 0)
                drop2(database, found);
            }
          this.#create(database);
        }
      }, { mode: "immediate" });
    } finally {
      if (unchecked)
        database.exec("PRAGMA foreign_keys = ON");
    }
  }
  #create(database) {
    for (const object of this.#objects)
      if (stored2(database, object.name) === void 0)
        database.exec(object.sql);
  }
  #stale(database) {
    return this.#objects.flatMap((object) => {
      const found = stored2(database, object.name);
      return found !== void 0 && found.sql !== object.sql ? [{ object, found }] : [];
    });
  }
  // Drops each stale index, trigger and view, rebuilds each stale table, and
  // gives the names of the rebuilt tables. SQLite keeps PRAGMA
  // legacy_alter_table after a rollback, so the old value comes back in any
  // case.
  #keep(database, stale) {
    const tables2 = stale.filter(({ object, found }) => object.type === "table" && found.type === "table");
    for (const entry of stale)
      if (!tables2.includes(entry))
        drop2(database, entry.found);
    if (tables2.length === 0)
      return [];
    const legacy = Number(database.prepare("PRAGMA legacy_alter_table").get()?.legacy_alter_table);
    database.exec("PRAGMA legacy_alter_table = ON");
    try {
      for (const { object, found } of tables2)
        this.#rebuild(database, object, found);
    } finally {
      database.exec(`PRAGMA legacy_alter_table = ${legacy}`);
    }
    const broken = database.prepare("PRAGMA foreign_key_check").get();
    if (broken !== void 0)
      throw new Error(`The kept rows break a foreign key: row ${String(broken.rowid)} of ${String(broken.table)} refers to a row of ${String(broken.parent)} that does not exist.`);
    return tables2.map(({ object }) => object.name);
  }
  // Renames the stored table away, makes it from its declared text, and copies
  // the columns that both have, by name. With legacy_alter_table on, the
  // rename leaves the references of other tables, views and triggers to the
  // name. A column only the declaration has gets its default, and a column
  // only the stored table has is discarded. The indexes and triggers on the
  // table go with the old table, so those the declaration does not name are
  // made again here, and the others when apply makes the missing objects.
  #rebuild(database, object, found) {
    const declared = new Set(this.#objects.map(({ name }) => name.toLowerCase()));
    const undeclared = database.prepare(`SELECT "name", "sql" FROM sqlite_schema WHERE lower("tbl_name") = lower(?) AND "type" IN ('index', 'trigger') AND "sql" IS NOT NULL`).all(found.name).filter(({ name }) => !declared.has(String(name).toLowerCase())).map(({ sql }) => String(sql));
    const old = `${found.name}_${randomUUID4().replaceAll("-", "")}`;
    database.exec(`ALTER TABLE ${quote5(found.name)} RENAME TO ${quote5(old)}`);
    database.exec(object.sql);
    const columns2 = new Set(names2(database, object.name).map((name) => name.toLowerCase()));
    const shared = names2(database, old).filter((name) => columns2.has(name.toLowerCase())).map(quote5).join(", ");
    if (shared !== "")
      database.exec(`INSERT INTO ${quote5(object.name)} (${shared}) SELECT ${shared} FROM ${quote5(old)}`);
    database.exec(`DROP TABLE ${quote5(old)}`);
    for (const sql of undeclared)
      database.exec(sql);
  }
};
function stored2(database, name) {
  const row = database.prepare('SELECT "type", "name", "sql" FROM sqlite_schema WHERE lower("name") = lower(?)').get(name);
  return row === void 0 ? void 0 : { type: String(row.type), name: String(row.name), sql: String(row.sql) };
}
function quote5(name) {
  return `"${name.replaceAll('"', '""')}"`;
}
function drop2(database, object) {
  database.exec(`DROP ${object.type.toUpperCase()} ${quote5(object.name)}`);
}
function names2(database, table) {
  return database.prepare('SELECT "name" FROM pragma_table_info(?)').all(table).map(({ name }) => String(name));
}
function compiled2(database) {
  return new Set(database.prepare(`SELECT "name" FROM sqlite_schema WHERE "type" = 'view'`).all().map(({ name }) => String(name)).filter((name) => {
    try {
      database.prepare(`SELECT * FROM ${quote5(name)} WHERE 0`);
      return true;
    } catch {
      return false;
    }
  }));
}
function verify2(database, tables2, views) {
  for (const table of tables2) {
    const columns2 = names2(database, table).map(quote5);
    const name = quote5(table);
    database.prepare(`DELETE FROM ${name} WHERE 0`);
    database.prepare(`INSERT INTO ${name} (${columns2.join(", ")}) SELECT ${columns2.join(", ")} FROM ${name} WHERE 0`);
    database.prepare(`UPDATE ${name} SET ${columns2.map((column) => `${column} = ${column}`).join(", ")} WHERE 0`);
  }
  for (const view of views)
    try {
      database.prepare(`SELECT * FROM ${quote5(view)} WHERE 0`);
    } catch (error) {
      throw new Error(`The rebuild breaks the view ${view}.`, {
        cause: error
      });
    }
}
function referenced2(database, table) {
  return database.prepare(`SELECT 1 FROM sqlite_schema AS "s", pragma_foreign_key_list("s"."name") AS "f" WHERE "s"."type" = 'table' AND lower("f"."table") = lower(?)`).get(table) !== void 0;
}

// node_modules/@zukhruf/sqlite-transaction/dist/transaction.js
var SAVEPOINT4 = "zukhruf_transaction";
function transaction4(database, work, options) {
  const owns = !database.isTransaction;
  database.exec(owns ? `BEGIN ${options.mode.toUpperCase()}` : `SAVEPOINT ${SAVEPOINT4}`);
  try {
    const result = work();
    if (thenable4(result))
      throw new TypeError("A transaction function cannot return a promise");
    database.exec(owns ? "COMMIT" : `RELEASE ${SAVEPOINT4}`);
    return result;
  } catch (error) {
    if (database.isTransaction)
      database.exec(owns ? "ROLLBACK" : `ROLLBACK TO ${SAVEPOINT4}; RELEASE ${SAVEPOINT4}`);
    throw error;
  }
}
function thenable4(value) {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

// packages/settings/dist/selection.js
var named = { accountIds: "account", collectionIds: "collection" };
function selectionProblems(selections, facts) {
  const problems = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { connector, scope } of selections) {
    if (seen.has(connector))
      problems.push(`${connector}: choose each connector once`);
    seen.add(connector);
    const traits = facts(connector);
    for (const kind of ["accountIds", "collectionIds"]) {
      const ids = scope[kind];
      if (ids === void 0)
        continue;
      if (!traits.narrowsBy(kind))
        problems.push(`${connector}: cannot be narrowed by ${named[kind]} IDs`);
      if (ids.length === 0)
        problems.push(`${connector}: choose at least one ${named[kind]}`);
      if (new Set(ids).size !== ids.length)
        problems.push(`${connector}: choose each ${named[kind]} once`);
    }
    if (traits.datedBy === null && (scope.startAt !== void 0 || scope.endAt !== void 0))
      problems.push(`${connector}: date filtering is unavailable`);
    if (scope.startAt !== void 0 && scope.endAt !== void 0 && scope.startAt >= scope.endAt)
      problems.push(`${connector}: start must precede end`);
  }
  return problems;
}

// packages/settings/dist/settings.js
var writerWaitMs = 3e4;
var heartbeatMs = 1e3;
var settingsTables = new Declaration2([
  "CREATE TABLE selections (position INTEGER PRIMARY KEY, connector TEXT NOT NULL UNIQUE, scope TEXT NOT NULL, include_attachments INTEGER NOT NULL, directory TEXT NOT NULL, permissions TEXT NOT NULL)",
  "CREATE TABLE connection_failures (directory TEXT PRIMARY KEY, error TEXT NOT NULL, failure_type TEXT NOT NULL CHECK (failure_type IN ('config', 'system')), failed_at TEXT NOT NULL)",
  "CREATE TABLE watched (connector TEXT PRIMARY KEY)",
  "CREATE TABLE transcription (id INTEGER PRIMARY KEY CHECK (id = 1), model TEXT NOT NULL)"
], { rows: "replace" });
function importDirectory(root, selection) {
  return join4(root, importFolder(selection));
}
function importFolder(selection) {
  const key = createHash5("sha256").update(JSON.stringify([selection.scope, selection.includeAttachments])).digest("hex").slice(0, 16);
  return join4(selection.connector, key);
}
var ConnectorRemovedError = class extends Error {
  name = "ConnectorRemovedError";
  constructor(connector) {
    super(`${connector} was removed from the selection`);
  }
};
var selectedConnectors = {
  name: "selected_connectors",
  description: "The connectors the user chose to import, in the order chosen. A connector missing here is not imported. Each import is its own SQLite file: open database to read its records, catalog and sync_status.",
  columns: {
    connector: "Connector name, such as mail, notes or messages.",
    scope: "JSON of the chosen accounts (accountIds), collections (collectionIds) and dates (startAt inclusive, endAt exclusive); an absent key means all.",
    include_attachments: "1 when attachment bytes are copied beside the records, 0 for metadata only.",
    database: "Path of the SQLite file the import loads, relative to the folder that holds this settings file. It may not exist yet while the first import starts.",
    connection_error: "Why the import last failed in a way sync_status cannot record, such as missing macOS access or a database it could not write; NULL when sync_status has the outcome. A connector with an error is inaccessible, not empty.",
    connection_failure_type: "config when the user can fix connection_error by giving access or changing what they set up, and permissions says how; system for any other reason; NULL when sync_status has the outcome.",
    connection_failed_at: "When the import last failed in a way sync_status cannot record, as an ISO 8601 UTC timestamp; NULL when sync_status has the outcome.",
    permissions: "What the user can do in macOS to give access to this app."
  },
  query: `SELECT s."connector", s."scope", s."include_attachments", s."directory" || '/data.sqlite' AS "database",
      f."error" AS "connection_error", f."failure_type" AS "connection_failure_type", f."failed_at" AS "connection_failed_at", s."permissions"
    FROM "selections" s LEFT JOIN "connection_failures" f ON f."directory" = s."directory"
    ORDER BY s."position"`
};
var Settings = class {
  root;
  settings;
  constructor(root) {
    this.root = root;
    mkdirSync(root, { recursive: true, mode: 448 });
    chmodSync2(root, 448);
    const path = this.#path;
    this.settings = new DatabaseSync10(path, { timeout: writerWaitMs });
    try {
      chmodSync2(path, 384);
      const built = settingsTables.drift(this.settings) !== "fits";
      settingsTables.apply(this.settings);
      if (built)
        this.#publish();
    } catch (error) {
      this.settings.close();
      throw error;
    }
  }
  get #path() {
    return join4(this.root, "settings.sqlite");
  }
  selections() {
    return this.settings.prepare("SELECT connector, scope, include_attachments FROM selections ORDER BY position").all().map((row) => ({
      connector: String(row.connector),
      scope: JSON.parse(String(row.scope)),
      includeAttachments: row.include_attachments === 1
    }));
  }
  // The transcription model the user chose, by its file name: the hosts find
  // the file on whichever Mac reads the store.
  transcription() {
    const row = this.settings.prepare("SELECT model FROM transcription WHERE id = 1").get();
    if (row === void 0)
      return null;
    if (typeof row.model !== "string")
      throw new TypeError("Invalid stored transcription model");
    return row.model;
  }
  setTranscription(model) {
    if (model === null)
      this.settings.exec("DELETE FROM transcription");
    else
      this.settings.prepare("INSERT INTO transcription VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET model = excluded.model").run(model);
  }
  // The selected connectors the user keeps current, in the order chosen. A
  // narrowed connector stays kept current; a disconnected one is forgotten.
  watched() {
    return this.settings.prepare("SELECT connector FROM watched JOIN selections USING (connector) ORDER BY position").all().map(({ connector }) => String(connector));
  }
  // Keeps a selected connector current; one not selected stays as it is.
  watch(connector) {
    this.settings.prepare("INSERT OR IGNORE INTO watched SELECT connector FROM selections WHERE connector = ?").run(connector);
  }
  unwatch(connector) {
    this.settings.prepare("DELETE FROM watched WHERE connector = ?").run(connector);
  }
  // Saves a selection that has no problems, with what macOS needs granted for
  // each connector, forgets the failures of every other import and publishes
  // what readers see. The imports it no longer names are left stale.
  select(selections, { facts, permissions }) {
    const problems = selectionProblems(selections, facts);
    if (problems.length > 0)
      throw new Error(problems.join("\n"));
    transaction4(this.settings, () => {
      this.settings.exec("DELETE FROM selections");
      const insert = this.settings.prepare("INSERT INTO selections VALUES(?,?,?,?,?,?)");
      for (const [position, selection] of selections.entries())
        insert.run(position, selection.connector, JSON.stringify(selection.scope), selection.includeAttachments ? 1 : 0, importFolder(selection), permissions(selection));
      this.settings.exec("DELETE FROM connection_failures WHERE directory NOT IN (SELECT directory FROM selections)");
      this.settings.exec("DELETE FROM watched WHERE connector NOT IN (SELECT connector FROM selections)");
    }, { mode: "immediate" });
    this.#publish();
  }
  // Every import directory but the selected one of each connector, including
  // those of connectors no longer selected. A host removes each once no pass
  // runs it, since a pass keeps its locks inside.
  staleImports() {
    const kept = new Set(this.selections().map((selection) => this.directory(selection)));
    return readdirSync(this.root, { withFileTypes: true }).filter((connector) => connector.isDirectory()).flatMap((connector) => readdirSync(join4(this.root, connector.name)).map((entry) => join4(this.root, connector.name, entry))).filter((directory) => !kept.has(directory));
  }
  // Aborts with ConnectorRemovedError once the selection no longer names this
  // import. It reads the settings again only when PRAGMA data_version says
  // another connection committed.
  removal(selection) {
    const folder = importFolder(selection);
    const watcher = new DatabaseSync10(this.#path, {
      readOnly: true,
      timeout: writerWaitMs
    });
    const version = watcher.prepare("PRAGMA data_version");
    const selected = watcher.prepare("SELECT 1 FROM selections WHERE directory = ?");
    const controller = new AbortController();
    let seen;
    const check = () => {
      try {
        const current = version.get()?.data_version;
        if (current === seen)
          return;
        seen = current;
        if (selected.get(folder) === void 0)
          controller.abort(new ConnectorRemovedError(selection.connector));
      } catch (error) {
        controller.abort(error);
      }
    };
    check();
    const heartbeat = setInterval(check, heartbeatMs);
    const stop = () => {
      clearInterval(heartbeat);
      if (watcher.isOpen)
        watcher.close();
    };
    controller.signal.addEventListener("abort", stop, { once: true });
    return { signal: controller.signal, [Symbol.dispose]: stop };
  }
  // Publishes selected_connectors and the catalog listing it; safe to repeat.
  #publish() {
    publishSQLiteViews(this.settings, { views: [selectedConnectors] });
    installSQLiteCatalog({ path: this.#path });
  }
  directory(selection) {
    return importDirectory(this.root, selection);
  }
  database(selection) {
    return join4(this.directory(selection), "data.sqlite");
  }
  connectionFailure(selection) {
    const row = this.settings.prepare("SELECT error, failure_type, failed_at FROM connection_failures WHERE directory=?").get(importFolder(selection));
    return row === void 0 ? void 0 : {
      error: String(row.error),
      failedAt: String(row.failed_at),
      failureType: row.failure_type === "config" ? "config" : "system"
    };
  }
  saveConnectionFailure(selection, error, failureType2) {
    this.settings.prepare("INSERT INTO connection_failures (directory, error, failure_type, failed_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(directory) DO UPDATE SET error=excluded.error, failure_type=excluded.failure_type, failed_at=excluded.failed_at").run(importFolder(selection), error, failureType2);
  }
  clearConnectionFailure(selection) {
    this.settings.prepare("DELETE FROM connection_failures WHERE directory=?").run(importFolder(selection));
  }
  [Symbol.dispose]() {
    this.settings.close();
  }
};

// packages/connectors/connector/dist/attachment-text.js
import { lstat } from "node:fs/promises";
import { basename as basename2, extname, join as join5 } from "node:path";
import { DatabaseSync as DatabaseSync11 } from "node:sqlite";
var concurrency = 4;
var rawAttachmentText = new Declaration2([
  `CREATE TABLE raw_attachment_text (ref TEXT PRIMARY KEY, sha256 TEXT NOT NULL, parser TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('parsed', 'no_text', 'failed')), content TEXT, error TEXT)`
], { rows: "replace" });
var columns = {
  ref: "Path of the stored copy, relative to the import's files folder: the attachmentRef value of every row whose file it is. Join attachmentRef to it.",
  sha256: "SHA-256 of the file bytes, which also names the stored copy. Rows of different tables that hold the same file share it.",
  parser: "Identity of the format and model that read the file. A file is read again when that identity changes.",
  status: "parsed: content holds the text. no_text: the parser read the file and found no text it can represent, such as a photo without words or audio when transcription is off. failed: reading the file failed and error says why; the file is read again after the next sync.",
  content: "The text the parser extracted. NULL unless status is parsed.",
  error: "Why reading the file failed. NULL unless status is failed."
};
var AttachmentText = class {
  #path;
  #files;
  #views;
  #parser;
  // files: the folder the import stores files in, which attachmentRef is
  // relative to. views: the import's reader views whose rows carry one.
  constructor(path, files, views, parser) {
    this.#path = path;
    this.#files = files;
    this.#views = views;
    this.#parser = parser;
  }
  // Each read commits on its own, so readers see text as it lands and an
  // update stopped partway keeps what it read; signal stops it taking more.
  async update(signal) {
    var _stack = [];
    try {
      const database = __using(_stack, new DatabaseSync11(this.#path, { timeout: 3e4 }));
      const due = this.#reconcile(database);
      const failures = [];
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, async () => {
        while (failures.length === 0 && !signal.aborted) {
          const ref = due[next++];
          if (ref === void 0)
            return;
          await this.#read(database, ref, signal).catch((error) => {
            failures.push(error);
          });
        }
      }));
      if (failures.length > 0)
        throw failures[0];
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  // Publishes the table and its view, forgets the files no row references,
  // and returns the ones they still reference; #read skips those already read.
  #reconcile(database) {
    return transaction4(database, () => {
      rawAttachmentText.apply(database);
      publishSQLiteViews(database, {
        views: [
          {
            name: "attachment_text",
            description: "One row per file this import stored, with the text its parser extracted, read after each sync. A stored file not read yet has no row, so search results are complete only once the text caught up with the sync. Primary key ref.",
            columns,
            query: `SELECT ${Object.keys(columns).join(", ")} FROM raw_attachment_text`
          }
        ]
      });
      const present = new Set(database.prepare(`SELECT name FROM sqlite_schema WHERE type = 'view' AND name IN (${this.#views.map(() => "?").join(", ")})`).all(...this.#views).map(({ name }) => String(name)));
      const referenced3 = this.#views.filter((view) => present.has(view)).map((view) => `SELECT DISTINCT attachmentRef AS ref FROM "${view}" WHERE attachmentRef IS NOT NULL`).join(" UNION ") || "SELECT NULL AS ref WHERE 0";
      database.exec(`DELETE FROM raw_attachment_text WHERE ref NOT IN (${referenced3})`);
      return database.prepare(`SELECT ref FROM (${referenced3}) ORDER BY ref`).all().map(({ ref }) => String(ref));
    }, { mode: "immediate" });
  }
  async #read(database, ref, signal) {
    let status2;
    let content = null;
    let error = null;
    const parser = this.#parser();
    const file = join5(this.#files, ref);
    let identity = parser.identity;
    try {
      const format = await parser.identityFor(file);
      const previous = database.prepare("SELECT parser, status FROM raw_attachment_text WHERE ref = ?").get(ref);
      if (format === null && previous?.status === "parsed")
        return;
      identity = format ?? "unsupported";
      if (previous?.parser === identity && previous.status !== "failed")
        return;
      if (format !== null)
        content = await parser.parse(file, signal);
      status2 = content === null ? "no_text" : "parsed";
    } catch (failure) {
      if (signal.aborted || failure instanceof Error && failure.name === "AbortError")
        return;
      if (await removed(file))
        return;
      status2 = "failed";
      error = failure instanceof Error ? failure.message : String(failure);
    }
    database.prepare(`INSERT INTO raw_attachment_text (ref, sha256, parser, status, content, error) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (ref) DO UPDATE SET sha256 = excluded.sha256, parser = excluded.parser, status = excluded.status, content = excluded.content, error = excluded.error`).run(ref, basename2(ref, extname(ref)), identity, status2, content, error);
  }
};
async function removed(path) {
  return lstat(path).then(() => false, (error) => {
    if (error.code === "ENOENT")
      return true;
    throw error;
  });
}

// packages/connectors/connector/dist/connector.js
var Connector = class {
  name;
  title;
  // Where the connector keeps its presets, beside its manifest; it may not
  // exist.
  presetsFolder;
  // What to know before narrowing this connector, such as how the app's
  // collections nest.
  note;
  // For a connector with no choices: a stream read only to show the app's store
  // opens.
  probe;
  // Views over the import's own views, such as Mail's mail_content_status,
  // published after each pass: a stream's view exists only once a pass
  // committed it. copied names the streams the import holds; a narrowed one
  // leaves out unscoped.
  views(_copied) {
    return [];
  }
  // Content availability the app can establish from its imported reader views.
  // This does not turn a successful local copy into a claim about cloud data.
  contentStatus(_database) {
    return [];
  }
  // Only the connector knows which upstream errors a fresh pass can recover.
  retryImport(_error) {
    return false;
  }
  host;
  constructor(host, identity) {
    this.host = host;
    this.name = identity.name;
    this.title = identity.title;
    this.presetsFolder = join6(identity.folder, "presets");
  }
  // Read when asked, so a preset added to a user connector's folder is offered
  // without a restart.
  presets() {
    if (!existsSync3(this.presetsFolder))
      return [];
    return readdirSync2(this.presetsFolder).filter((file) => file.endsWith(".sql")).sort().map((file) => ({
      name: file.slice(0, -".sql".length),
      file: join6(this.presetsFolder, file)
    }));
  }
  // The source an import loads from; listing choices reads source(scope).
  importSource({ scope }) {
    return this.source(scope);
  }
  // The scope an import uses for what its selection leaves out.
  defaultScope() {
    return {};
  }
  narrowsBy(kind) {
    return this.choices.some(({ scope }) => scope === kind);
  }
  guidance() {
    const { grantee } = this.host;
    return [
      ...this.fullDiskAccess ? [
        `Turn on ${grantee} in System Settings \u203A Privacy & Security \u203A Full Disk Access, then quit and reopen ${grantee}. macOS does not ask for this access.`
      ] : [],
      this.access(grantee)
    ].join(" ");
  }
  // Whose an error is to fix, as this connector's source classifies it.
  failureType(error) {
    return this.source(this.defaultScope()).failureType(error);
  }
  // What failed, and, when it is the user's to fix, what macOS access the app
  // needs. A failure the history or settings kept passes the type they
  // stored; null, for a stopped pass, has nothing for the user to fix.
  failure(error, failureType2 = this.failureType(error)) {
    const message2 = error instanceof Error ? error.message : String(error);
    return failureType2 === "config" ? `${message2} \u2014 ${this.guidance()}` : message2;
  }
  // What a selection of this connector covers, in a person's words.
  describe(scope) {
    const parts = [
      ...this.choices.flatMap(({ scope: ids, title }) => {
        const count = scope[ids]?.length;
        if (count === void 0)
          return [];
        return [
          `${count} ${count === 1 ? title.replace(/(x)es$|s$/, "$1") : title}`
        ];
      }),
      ...scope.startAt ? [`from ${localDay(Date.parse(scope.startAt))}`] : [],
      // endAt is exclusive: the last day covered is the one before it.
      ...scope.endAt ? [`until ${localDay(Date.parse(scope.endAt) - 1)}`] : []
    ];
    return parts.length === 0 ? "everything" : parts.join(", ");
  }
  // The connector's title and what a selection of it covers, as one phrase.
  titled(scope) {
    const covers = this.describe(scope);
    return covers === "everything" ? this.title : `${this.title} (${covers})`;
  }
  // The reader view of a stream: raw_inlineAttachments reads as
  // inline_attachments.
  view(stream) {
    return stream.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }
  // The rows of the streams this connector can be narrowed by. Opening the
  // app's store is also what makes macOS ask for access, so a denial fails
  // here, before anything is selected.
  async choiceRows() {
    const source = this.source(this.defaultScope());
    const catalog = await source.discover();
    const streams = this.probe === void 0 ? this.choices.map(({ stream }) => stream) : [this.probe];
    const rows = /* @__PURE__ */ new Map();
    for await (const message2 of source.read(streams.map((stream) => new CopyConfiguration(catalog.get(stream), {
      syncMode: "full_refresh",
      destinationSyncMode: "overwrite"
    })), /* @__PURE__ */ new Map())) {
      if (message2 instanceof StreamStatus) {
        if (message2.status === "FAILED")
          throw message2.error;
        continue;
      }
      if (!("type" in message2) && message2.stream !== this.probe)
        rows.set(message2.stream, [
          ...rows.get(message2.stream) ?? [],
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- every source validates its records against the stream's object schema
          message2.data
        ]);
    }
    return rows;
  }
  async listChoices() {
    const rows = await this.choiceRows();
    return this.choices.map((choice) => ({
      ...choice,
      options: (rows.get(choice.stream) ?? []).map((row) => ({
        id: choice.id(row),
        label: choice.label(row, rows)
      }))
    }));
  }
  // One pass of this connector's import, as every host runs it inside the
  // import's flight: stopped once the user removes the connector or signal
  // aborts, as a flight's lease does once the flight is no longer its
  // leader's, its outcome in the import's sync history, and in the settings
  // any failure that history could not record, a failure to connect among
  // them. The attachment text is read once the import has committed the
  // files it stored, so a sync ends with the text of its own files; it is
  // read even when some copies failed, from the files that did commit.
  async import(settings, selection, observer, signal) {
    return this.#load(settings, selection, observer, signal, async (pipeline, text3, removal, publish2) => {
      const stopped = signal === void 0 ? removal : AbortSignal.any([removal, signal]);
      let completed = false;
      await pRetry(async () => {
        let failed = null;
        try {
          await pipeline.run({ signal: stopped });
        } catch (error) {
          if (!(error instanceof PipelineError))
            throw error;
          failed = error;
        }
        publish2();
        await text3?.update(stopped);
        if (failed !== null)
          throw failed;
        completed = true;
      }, {
        retries: 2,
        minTimeout: 250,
        factor: 2,
        signal: stopped,
        shouldRetry: ({ error }) => error instanceof PipelineError && error.errors.some((failure) => this.retryImport(failure))
      }).catch((error) => {
        if (completed && stopped.aborted)
          return;
        stopped.throwIfAborted();
        throw error;
      });
    });
  }
  // Keeps this connector's import current: a pass at once, then one for each
  // change its source reports, each recorded in the import's sync history.
  // The attachment text is read after each pass, coalesced: while it reads,
  // passes only ask for one more read, so the import never waits on it.
  // Ends once the user removes the connector, once the source stops
  // reporting changes, or quietly once signal aborts; otherwise it lasts as
  // long as the process.
  async watch(settings, selection, observer, signal) {
    return this.#load(settings, selection, observer, signal, async (pipeline, text3, removal, publish2) => {
      const stopping = new AbortController();
      const stopped = AbortSignal.any(signal === void 0 ? [removal, stopping.signal] : [removal, stopping.signal, signal]);
      const failures = [];
      let running = null;
      let again = false;
      const read = (attachments) => {
        if (running !== null) {
          again = true;
          return;
        }
        running = (async () => {
          do {
            again = false;
            await attachments.update(stopped);
          } while (again && !stopped.aborted);
        })().catch((error) => {
          failures.push(error);
          stopping.abort(error);
        }).finally(() => {
          running = null;
        });
      };
      try {
        for await (const _pass of pipeline.watch({ signal: stopped })) {
          publish2();
          if (text3 !== null)
            read(text3);
        }
      } finally {
        stopping.abort();
        await running;
      }
      if (failures.length > 0)
        throw failures[0];
      removal.throwIfAborted();
    });
  }
  async #load(settings, selection, observer, signal, load) {
    var _stack = [];
    try {
      const removal = __using(_stack, settings.removal(selection));
      let built;
      try {
        built = await this.connection(settings.directory(selection), selection);
      } catch (error) {
        settings.saveConnectionFailure(selection, error instanceof Error ? error.message : String(error), this.failureType(error));
        return { status: "unconnected", error };
      }
      settings.clearConnectionFailure(selection);
      const { connection, text: text3, destination } = built;
      const history = new SQLiteSyncHistory();
      try {
        await history.install([destination]);
        await history.failUnfinished(connection);
        installSQLiteCatalog(destination);
        const copied = connection.steps.map(({ configuration }) => configuration.stream.name);
        const views = this.views(new Set(copied));
        await load(new Pipeline({ connections: [connection], history, observer }), text3, removal.signal, () => publish(destination.path, copied.map((name) => this.view(name)), views));
      } catch (error) {
        if (error instanceof ConnectorRemovedError)
          return { status: "removed" };
        if (signal?.aborted && error === signal.reason)
          throw error;
        if (error instanceof PipelineError || error instanceof WatchError)
          return { status: "imported" };
        settings.saveConnectionFailure(selection, error instanceof Error ? error.message : String(error), this.failureType(error));
        throw error;
      }
      return { status: "imported" };
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  // The connector's streams, loaded incrementally into raw_<stream> tables of
  // the import directory's data.sqlite and read through documented views, with
  // checkpoints.sqlite and attachment copies in files/ beside it. When the
  // import stores files, text reads their text into attachment_text.
  async connection(directory, selection) {
    const { scope, includeAttachments } = selection;
    const source = await this.importSource(selection);
    const narrowed = Object.keys(scope).length > 0;
    const { streams } = await source.discover();
    const withFiles = (stream) => includeAttachments && stream.supportsFileTransfer === true && !this.storeCopies.includes(stream.name);
    mkdirSync2(directory, { recursive: true, mode: 448 });
    const destination = new SQLiteDestination({
      path: join6(directory, "data.sqlite")
    });
    const files = new LocalFiles({ directory: join6(directory, "files") });
    const copied = streams.filter(({ name }) => !(narrowed && this.unscoped.includes(name)));
    const connection = new Connection({
      name: this.name,
      source,
      destination,
      checkpoints: new SQLiteCheckpointStore({
        path: join6(directory, "checkpoints.sqlite")
      }),
      steps: copied.map((stream) => new Copy(stream, destination.table(`raw_${stream.name}`, withFiles(stream) ? (columns2) => [
        ...SQLiteColumns.fromSchema(stream.jsonSchema),
        columns2.text("attachmentRef").from(stream.file.store(files))
      ] : void 0).withReaderView(this.view(stream.name)), {
        id: `${this.name}:${stream.name}`,
        syncMode: "incremental",
        destinationSyncMode: "append_dedup"
      }))
    });
    const stored3 = copied.filter(withFiles);
    const text3 = stored3.length === 0 ? null : new AttachmentText(destination.path, files.directory, stored3.map(({ name }) => this.view(name)), () => this.host.documentParser);
    return { connection, text: text3, destination };
  }
};
function publish(path, readerViews, views) {
  var _stack = [];
  try {
    if (views.length === 0)
      return;
    const database = __using(_stack, new DatabaseSync12(path, { timeout: 3e4 }));
    const loaded = database.prepare(`SELECT 1 FROM sqlite_schema WHERE type = 'view' AND name = ?`);
    const waiting = readerViews.some((view) => loaded.get(view) === void 0);
    publishSQLiteViews(database, {
      views: waiting ? views.filter((view) => readable(database, view)) : views
    });
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    __callDispose(_stack, _error, _hasError);
  }
}
function readable(database, view) {
  try {
    database.prepare(view.query);
    return true;
  } catch {
    return false;
  }
}
function localDay(epochMilliseconds) {
  const instant = new Date(epochMilliseconds);
  const pad = (part) => String(part).padStart(2, "0");
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}

export {
  readSQLite,
  readPassStatus,
  Declaration2 as Declaration,
  transaction4 as transaction,
  Settings,
  Connector
};
