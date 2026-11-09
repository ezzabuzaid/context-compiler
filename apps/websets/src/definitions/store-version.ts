import { DataVersion } from '@zukhruf/sqlite-data-version';

import { Gauge } from '@eltjs/elt';

// What tells the pipeline that the consumers changed what they asked: the
// data version of api.sqlite, which each commit of the API changes. It opens
// the file at its first read, as a change signal's gauge does (elt ADR 0020),
// and as elt's AppDatabaseVersion reads an app's store (docs/copied-code.md).
// The API makes the file before the pipeline starts, so it is always there.
export class StoreVersion extends Gauge<number> implements Disposable {
  #state: VersionState;

  constructor(path: string) {
    super();
    this.#state = new Closed(path);
  }

  protected async read(): Promise<number> {
    const { value, state } = this.#state.read();
    this.#state = state;
    return value;
  }

  [Symbol.dispose](): void {
    this.#state[Symbol.dispose]();
  }
}

interface VersionState extends Disposable {
  read(): { readonly value: number; readonly state: VersionState };
}

// Before the first read, nothing is open.
class Closed implements VersionState {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  read() {
    return new Opened(new DataVersion(this.#path)).read();
  }

  [Symbol.dispose](): void {}
}

class Opened implements VersionState {
  readonly #version: DataVersion;

  constructor(version: DataVersion) {
    this.#version = version;
  }

  read() {
    return { value: this.#version.current, state: this };
  }

  [Symbol.dispose](): void {
    this.#version[Symbol.dispose]();
  }
}
