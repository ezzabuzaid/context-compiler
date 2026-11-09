import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { categories } from '@eltjs/source-opensooq-web/categories';
import { listings } from '@eltjs/source-opensooq-web/listings';
import { InputError, WebSource } from '@eltjs/source-web-pages/web-source';
import type { Choice } from '@workspace/connector/choice';
import { Connector, type Selection } from '@workspace/connector/connector';

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
  protected sources(): readonly [WebSource] {
    return [
      new WebSource({
        streams: [{ stream: categories, inputs: [home] }],
        cachePath: join(
          tmpdir(),
          'context-compiler-opensooq',
          'web-http.sqlite',
        ),
      }),
    ];
  }

  // The listings of the chosen categories, beside the categories. A stream
  // with no input reads nothing, so with no category chosen the import would
  // load no listing and report success. WebSource classes InputError as the
  // user's to fix, so access() tells them to choose one.
  protected override importSources(
    { scope }: Selection,
    directory: string,
  ): readonly [WebSource] {
    if (!scope.collectionIds)
      throw new InputError('No OpenSooq category is chosen.');
    return [
      new WebSource({
        streams: [
          { stream: categories, inputs: [home] },
          { stream: listings, inputs: scope.collectionIds },
        ],
        cachePath: join(directory, 'web-http.sqlite'),
      }),
    ];
  }
}
