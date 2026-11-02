export type Row = Record<string, unknown>;

export function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export type Rows = ReadonlyMap<string, readonly Row[]>;

// A stream listing the accounts or collections an import can be narrowed to.
export type Choice = {
  readonly stream: string;
  readonly scope: 'accountIds' | 'collectionIds';
  readonly title: string;
  id(row: Row): string;
  label(row: Row, rows: Rows): string;
};

export const name = (row: Row) => String(row.name);
export const byId = (row: Row) => String(row.id);

export const accounts = (label: Choice['label']): Choice => ({
  stream: 'accounts',
  scope: 'accountIds',
  title: 'accounts',
  id: byId,
  label,
});

// Collection names repeat across accounts, such as a Notes folder per account.
export const collections = (stream: string, title: string): Choice => ({
  stream,
  scope: 'collectionIds',
  title,
  id: byId,
  label: (row, rows) => {
    const account = rows
      .get('accounts')
      ?.find(({ id }) => id === row.accountId);
    return account === undefined
      ? name(row)
      : `${name(account)} / ${name(row)}`;
  },
});
