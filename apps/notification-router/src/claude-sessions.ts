import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { sessionsFolder } from './places.ts';

// A session's file can lack its status for a moment (seen 2026-11-24 12:10:00).
const registryEntrySchema = z.object({
  sessionId: z.string(),
  name: z.string(),
  status: z.string().optional(),
  statusUpdatedAt: z.number().optional(),
});
export type ClaudeSession = z.infer<typeof registryEntrySchema>;

/** The registry each running Claude Code session writes to ~/.claude/sessions/<pid>.json. */
export function claudeSession(sessionId: string): ClaudeSession | undefined {
  for (const file of readdirSync(sessionsFolder)) {
    if (!file.endsWith('.json')) continue;
    const entry = readEntry(join(sessionsFolder, file));
    if (entry?.sessionId === sessionId) return entry;
  }
  return undefined;
}

function readEntry(path: string): ClaudeSession | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    // A session that exits removes its file between the listing and the read.
    if (Error.isError(error) && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
  try {
    return registryEntrySchema.parse(JSON.parse(text));
  } catch (error) {
    // A session that updates its file can be read halfway through the write.
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
