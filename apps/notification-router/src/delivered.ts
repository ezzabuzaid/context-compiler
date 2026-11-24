import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { stateFolder } from './places.ts';

const file = join(stateFolder, 'delivered.json');
const day = 24 * 60 * 60_000;
const deliveredSchema = z.record(z.string(), z.number());

/**
 * The notifications already handed to a session, kept across router restarts:
 * a woken session ends its turn again, and its next wait must not get the same
 * notification back.
 */
export class Delivered {
  readonly #at: Map<string, number>;

  constructor(now: number) {
    this.#at = new Map(
      Object.entries(read()).filter(([, at]) => now - at < day),
    );
  }

  has(uuid: string): boolean {
    return this.#at.has(uuid);
  }

  add(uuid: string, now: number): void {
    this.#at.set(uuid, now);
    writeFileSync(file, JSON.stringify(Object.fromEntries(this.#at)));
  }
}

function read(): Record<string, number> {
  try {
    return deliveredSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    if (Error.isError(error) && 'code' in error && error.code === 'ENOENT')
      return {};
    throw error;
  }
}
