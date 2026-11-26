import { booksLocation } from '@eltjs/sdk-apple-books';
import { AppleBooksSource } from '@eltjs/source-apple-books/apple-books-source';
import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

export default class BooksConnector extends Connector {
  readonly datedBy = null;
  // Books' collections are built-in lists; everything is imported.
  protected readonly choices: readonly Choice[] = [];
  // Collections live in the library store every Books import reads.
  protected override readonly probe = 'collections';
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected sources() {
    return [new AppleBooksSource(booksLocation(this.host.home))] as const;
  }
}
