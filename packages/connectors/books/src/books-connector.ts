import { booksLocation } from '@eltjs/sdk-apple-books';
import { AppleBooksSource } from '@eltjs/source-apple-books/apple-books-source';
import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

export default class BooksConnector extends Connector {
  readonly datedBy = null;
  readonly fullDiskAccess = true;
  // Books' collections are built-in lists; everything is imported.
  protected readonly choices: readonly Choice[] = [];
  // Collections live in the library store every Books import reads.
  protected override readonly probe = 'collections';
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(): string {
    return 'Books does not need to be open. Books stored only in iCloud are listed without their files; open them in Books to download them.';
  }

  protected sources() {
    return [new AppleBooksSource(booksLocation(this.host.home))] as const;
  }
}
