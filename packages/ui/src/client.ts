import type { App } from '@modelcontextprotocol/ext-apps';

// Hosts provide tool calls; only a chat host can open a monitor's chat.
export type PageClient = Pick<App, 'callServerTool'> &
  Partial<Pick<App, 'openLink'>>;
