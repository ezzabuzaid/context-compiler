import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import {
  Connector,
  type ConnectorHost,
  type ConnectorIdentity,
} from '@workspace/connector/connector';

// A connector package's package.json: an ES module package whose exports
// names the entry point, relative to the folder, and whose contextCompiler
// field holds the connector's name and title. npm's other fields are its own.
const manifestSchema = z.object({
  type: z.literal('module'),
  exports: z.string().startsWith('./'),
  contextCompiler: z.strictObject({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    title: z.string().min(1),
  }),
});

type ConnectorClass = new (
  host: ConnectorHost,
  identity: ConnectorIdentity,
) => Connector;

// What a connector package says it is, read without running its code.
export class ConnectorManifest {
  readonly name: string;
  readonly title: string;
  readonly folder: string;
  readonly entry: string;

  private constructor(
    folder: string,
    manifest: z.infer<typeof manifestSchema>,
  ) {
    this.name = manifest.contextCompiler.name;
    this.title = manifest.contextCompiler.title;
    this.folder = folder;
    this.entry = join(folder, manifest.exports);
  }

  // The folder's manifest; undefined when the folder holds no package.json
  // that declares a connector.
  static read(folder: string): ConnectorManifest | undefined {
    const path = join(folder, 'package.json');
    if (!existsSync(path)) return undefined;
    const json = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(path, 'utf8')));
    if (!('contextCompiler' in json)) return undefined;
    return new ConnectorManifest(folder, manifestSchema.parse(json));
  }

  // Runs the entry point and creates its connector for the host, named and
  // titled by this manifest. Node keeps a module it loaded, so the entry's URL
  // carries its modification time: an edited entry loads again. Files it
  // imports load once.
  async load(host: ConnectorHost): Promise<Connector> {
    const entry = pathToFileURL(this.entry);
    entry.searchParams.set('modified', String(statSync(this.entry).mtimeMs));
    const { default: Exported }: { default?: unknown } = await import(
      entry.href
    );
    if (!isConnectorClass(Exported))
      throw new TypeError(
        `${this.entry} does not export a Connector class by default.`,
      );
    return new Exported(host, {
      name: this.name,
      title: this.title,
      folder: this.folder,
    });
  }
}

function isConnectorClass(value: unknown): value is ConnectorClass {
  return typeof value === 'function' && value.prototype instanceof Connector;
}
