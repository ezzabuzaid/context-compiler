// A field that the API extracts from every item: text, a number, an ISO 8601
// date, a URL, or one of its options.
export type Field =
  | {
      readonly name: string;
      readonly description: string;
      readonly format: 'text' | 'number' | 'date' | 'url';
    }
  | {
      readonly name: string;
      readonly description: string;
      readonly format: 'options';
      readonly options: readonly string[];
    };

// What a consumer asks: the pages that meet every criterion, found by a web
// search, given as pages, or linked from lists, each with the fields to
// extract, as Exa's Websets take a search with criteria, imports and
// enrichments. A monitor searches again on a cron, at most once a day.
export type Definition = {
  readonly title: string;
  readonly search?: { readonly query: string; readonly count: number };
  readonly criteria: readonly { readonly description: string }[];
  readonly pages: readonly string[];
  readonly lists: readonly string[];
  readonly fields: readonly Field[];
  readonly monitor?: { readonly cron: string };
};
