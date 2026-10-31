import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Choice } from '@workspace/connector/choice';
import { Connector, type Selection } from '@workspace/connector/connector';
import { categories } from '@workspace/source-opensooq-web/categories';
import { listings } from '@workspace/source-opensooq-web/listings';
import { WebSource } from '@workspace/source-web-pages/web-source';

// The home page of OpenSooq Jordan, whose hidden menu links every category.
const home = 'https://jo.opensooq.com/en';

// A category under its top-level category, such as "Autos / Motorcycles".
const category: Choice['label'] = ({ name, group }) =>
  typeof group === 'string' ? `${group} / ${String(name)}` : String(name);

export default class OpenSooqConnector extends Connector {
  readonly datedBy = null;
  readonly fullDiskAccess = false;
  override readonly note =
    'OpenSooq has no Mac app, so the import reads jo.opensooq.com, the OpenSooq site for Jordan. Pick at least one category. A listing that was sold keeps its row, so some listings may no longer be for sale.';
  protected readonly choices: readonly Choice[] = [
    {
      stream: categories.name,
      scope: 'collectionIds',
      title: 'categories',
      id: ({ url }) => String(url),
      label: category,
    },
  ];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(): string {
    return 'Choose at least one OpenSooq category when you set up the connector.';
  }

  // The categories alone, for the choices. The home page sends no ETag or
  // Last-Modified, so a cache saves no download; one file in the OS's
  // temporary folder serves every listing of the choices.
  protected source(): WebSource {
    return new WebSource({
      streams: [{ stream: categories, inputs: [home] }],
      cachePath: join(tmpdir(), 'context-compiler-opensooq', 'web-http.sqlite'),
    });
  }

  // The listings of the chosen categories, beside the categories. With no
  // category chosen, the listings stream has no input, which the source
  // refuses as the user's to fix.
  protected override importSource(
    { scope }: Selection,
    directory: string,
  ): WebSource {
    return new WebSource({
      streams: [
        { stream: categories, inputs: [home] },
        { stream: listings, inputs: scope.collectionIds ?? [] },
      ],
      cachePath: join(directory, 'web-http.sqlite'),
    });
  }
}
