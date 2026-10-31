import {
  type Choice,
  type Row,
  accounts,
  byId,
} from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';
import type { ImportScope } from '@workspace/source-apple-macos/import-scope';
import { TeamsSource } from '@workspace/source-microsoft-teams/teams-source';

// An account by its organization's first domain.
const account: Choice['label'] = (row) => {
  const domains = Array.isArray(row.tenantDomains) ? row.tenantDomains : [];
  return String(domains[0] ?? row.tenantId);
};

// A team or chat that Teams stores no name for, by its kind and id.
const unnamed = (name: unknown, kind: unknown, row: Row): string =>
  name === null || name === undefined
    ? `${String(kind)} ${byId(row)}`
    : String(name);

// A conversation as Teams' chat list names it: a channel after its team, a
// team by its name, a chat by its topic or, without one, its members.
const conversation: Choice['label'] = (row, rows) => {
  if (row.type === 'Topic') {
    const team = rows.get('conversations')?.find(({ id }) => id === row.teamId);
    const channel = String(row.topic ?? 'channel');
    return team === undefined
      ? channel
      : `${String(team.teamName ?? team.topic ?? 'team')} / ${channel}`;
  }
  if (row.type === 'Space')
    return unnamed(row.teamName ?? row.topic, 'team', row);
  if (row.type === 'StreamOfNotes') return 'Notes';
  return unnamed(row.topic ?? row.title, row.type, row);
};

export default class TeamsConnector extends Connector {
  readonly datedBy = 'date sent';
  readonly fullDiskAccess = true;
  override readonly note =
    'Teams keeps only the messages it has loaded on this Mac, so older history is imported only once Teams loads it.';
  protected readonly choices: readonly Choice[] = [
    accounts(account),
    {
      stream: 'conversations',
      scope: 'collectionIds',
      title: 'conversations',
      id: byId,
      label: conversation,
    },
  ];
  protected readonly unscoped = [];
  protected readonly storeCopies = [];

  protected access(): string {
    return 'Open Microsoft Teams, sign in and let it run: it saves what it loads as you use it, and only what it has loaded on this Mac is imported.';
  }

  protected source(scope: ImportScope) {
    return new TeamsSource(undefined, scope);
  }
}
