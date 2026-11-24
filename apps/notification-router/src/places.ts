import { homedir } from 'node:os';
import { join } from 'node:path';

import { PipeEndpoint } from '@zukhruf/pipes';

const contextCompiler = join(
  homedir(),
  'Library',
  'Application Support',
  'Context Compiler',
);

export const importsFolder = join(contextCompiler, 'Imports');
export const stateFolder = join(contextCompiler, 'Notification Router');
export const sessionsFolder = join(homedir(), '.claude', 'sessions');
export const endpoint = new PipeEndpoint('notification-router', {
  prefix: 'context-compiler',
});
