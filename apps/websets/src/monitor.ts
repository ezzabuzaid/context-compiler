// What a monitor checks: a page, whose extracted text it compares; a web
// search, whose new pages it reports; or a dataset, whose search it runs
// again, so that the pages it finds join the dataset.
export type Target =
  | { readonly page: string }
  | { readonly search: { readonly query: string; readonly count: number } }
  | { readonly dataset: string };

// What a consumer asks: a target to check on a cron, as Exa's monitors and
// TinyFish's Monitor check theirs.
export type MonitorDefinition = {
  readonly name: string;
  readonly target: Target;
  readonly cron: string;
};
