import { Federation, type Query } from '@zukhruf/sqlite-federation';
import { open } from '@zukhruf/sqlite-open';
import { z } from 'zod';

import type { Reading, Warehouse } from '@eltjs/eca';
import {
  SQLiteDestination,
  asOfDefinitions,
  asOfFunctions,
} from '@eltjs/elt-sqlite';

// A position of the imports: the position of each import it names, by the
// connector's name. Each import is its own file with its own numbering.
const positionSchema = z.record(z.string(), z.string());

type Positions = ReadonlyMap<string, string>;

const encode = (positions: Positions) =>
  JSON.stringify(Object.fromEntries([...positions].sort()));
const decode = (position: string): Positions =>
  new Map(Object.entries(positionSchema.parse(JSON.parse(position))));
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

// The imports as eca's warehouse, each read as of its own position with no
// copy: a reading is a federation over an in-memory main, where each import's
// tables and views are temporary views named `<import>_<name>`, as of the
// position the reading names, and the federation attaches an import when a
// statement reads its views. An import the position does not name is read at
// the newest position it had when this warehouse was made, on both sides of a
// step, so it first changes nothing and then moves with the others.
export class ImportsWarehouse implements Warehouse<Query> {
  readonly #imports: ReadonlyMap<string, SQLiteDestination>;
  readonly #newest: Positions;
  readonly #committed = new Map<string, Temporal.Instant>();
  readonly #views = new Map<string, readonly string[]>();

  // imports: the data.sqlite of each selected connector, by its name.
  constructor(imports: ReadonlyMap<string, string>) {
    this.#imports = new Map(
      [...imports].map(([name, path]) => [
        name,
        new SQLiteDestination({ path }),
      ]),
    );
    const newest = new Map<string, string>();
    for (const [name, destination] of this.#imports) {
      const positions = destination.positions();
      if ('expired' in positions) continue;
      const last = positions.at(-1);
      if (last !== undefined) newest.set(name, last);
    }
    this.#newest = newest;
  }

  // The positions after one, one import moved in each, in order of their
  // commits, ties by import name. A first step names each import the
  // position did not, at its newest, and drops each that is no longer
  // selected. An import that can no longer read its position expires it.
  async stable(
    after: string,
  ): Promise<readonly string[] | { readonly expired: string }> {
    const from = decode(after);
    const moves: { name: string; position: string; at: Temporal.Instant }[] =
      [];
    for (const [name, destination] of this.#imports) {
      const position = from.get(name);
      if (position === undefined) continue;
      const next = destination.positions(position);
      if ('expired' in next)
        return { expired: `The ${name} import: ${next.expired}` };
      for (const later of next) {
        const at = this.#at(name, destination, later);
        if (!(at instanceof Temporal.Instant)) return at;
        moves.push({ name, position: later, at });
      }
    }
    moves.sort(
      (left, right) =>
        Temporal.Instant.compare(left.at, right.at) ||
        left.name.localeCompare(right.name),
    );
    const current = new Map(
      [...from].filter(([name]) => this.#imports.has(name)),
    );
    for (const [name, position] of this.#newest)
      if (!current.has(name)) current.set(name, position);
    const steps = encode(current) === encode(from) ? [] : [encode(current)];
    for (const { name, position } of moves) {
      current.set(name, position);
      steps.push(encode(current));
    }
    return steps;
  }

  async read(
    position?: string,
  ): Promise<(Reading<Query> & Disposable) | { readonly expired: string }> {
    const positions = new Map(this.#newest);
    if (position !== undefined)
      for (const [name, named] of decode(position))
        if (this.#imports.has(name)) positions.set(name, named);
    let at = Temporal.Instant.fromEpochMilliseconds(0);
    for (const [name, destination] of this.#imports) {
      const named = positions.get(name);
      if (named === undefined) continue;
      const committed = this.#at(name, destination, named);
      if (!(committed instanceof Temporal.Instant)) return committed;
      if (Temporal.Instant.compare(committed, at) > 0) at = committed;
    }
    using stack = new DisposableStack();
    const federation = stack.use(
      new Federation({
        main: ':memory:',
        locate: (name) => this.#imports.get(name)?.path,
      }),
    );
    for (const [name, implementation] of Object.entries(asOfFunctions))
      federation.function(name, implementation);
    for (const [name, destination] of this.#imports) {
      const named = positions.get(name);
      if (named === undefined) continue;
      const definitions = this.#definitions(name, destination, named);
      if ('expired' in definitions) return definitions;
      for (const definition of definitions) federation.exec(definition);
    }
    const owned = stack.move();
    return {
      sql: federation.sql,
      position: encode(positions),
      at,
      [Symbol.dispose]: () => owned.dispose(),
    };
  }

  // The temporary views of an import as of a position, made once: the views
  // fail by themselves once the import can no longer read the position.
  #definitions(
    name: string,
    destination: SQLiteDestination,
    position: string,
  ): readonly string[] | { readonly expired: string } {
    const id = `${name} ${position}`;
    const known = this.#views.get(id);
    if (known !== undefined) return known;
    using definer = open(':memory:', { readOnly: true });
    definer
      .prepare(`ATTACH DATABASE ? AS ${quote(name)}`)
      .run(destination.path);
    const definitions = asOfDefinitions(definer, {
      schema: name,
      position,
      prefix: name,
    });
    if ('expired' in definitions)
      return { expired: `The ${name} import: ${definitions.expired}` };
    this.#views.set(id, definitions);
    return definitions;
  }

  // When an import's commit at a position was made, read once.
  #at(
    name: string,
    destination: SQLiteDestination,
    position: string,
  ): Temporal.Instant | { readonly expired: string } {
    const id = `${name} ${position}`;
    const known = this.#committed.get(id);
    if (known !== undefined) return known;
    const reading = destination.reading(position);
    if ('expired' in reading)
      return { expired: `The ${name} import: ${reading.expired}` };
    using _reading = reading;
    this.#committed.set(id, reading.at);
    return reading.at;
  }
}
