import type {
  CallToolRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

export const hostOrigin = 'cc-host://app';

const pageTools = [
  'connectors',
  'connector_choices',
  'connector_update',
  'connector_watch',
  'sync',
  'transcription',
  'transcription_update',
  'monitors',
  'open_full_disk_access',
] as const;

export function isPageTool(name: string): name is (typeof pageTools)[number] {
  return pageTools.some((tool) => tool === name);
}

export type PageToolParams = CallToolRequest['params'] & {
  name: (typeof pageTools)[number];
};
export type BackendState =
  | { status: 'starting' }
  | { status: 'ready' }
  | { status: 'failed'; message: string };
export type DesktopState = BackendState & { theme: 'light' | 'dark' };

export interface DesktopApi {
  state(): Promise<DesktopState>;
  retry(): Promise<void>;
  callTool(
    id: string,
    params: PageToolParams,
    timeout: number,
  ): Promise<CallToolResult>;
  cancelTool(id: string): void;
  onState(listener: (state: DesktopState) => void): () => void;
}

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
