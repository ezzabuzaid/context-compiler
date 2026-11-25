import { spawn } from 'node:child_process';
import type { Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';

import { NoServerError } from '@zukhruf/pipes';
import { z } from 'zod';

import { endpoint } from './places.ts';
import { type WaitRequest, deliverySchema } from './protocol.ts';

/** The fields of Claude Code's Stop hook input that the router reads. */
const stopInputSchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
  last_assistant_message: z.string().optional(),
});

const startTimeout = 10_000;

/**
 * Runs as the Stop hook with asyncRewake: it waits in the background while the
 * session is idle. Exit code 2 wakes the session with what it wrote to stderr;
 * exit code 0 ends the wait silently.
 */
export async function wait(): Promise<number> {
  // `claude -p` ends with its reply, so no later turn exists for a notification
  // to wake, and its process does not exit while this hook waits.
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli') return 0;
  const input = stopInputSchema.parse(JSON.parse(await text(process.stdin)));
  const request = input.last_assistant_message?.trim();
  if (!request) return 0;
  const socket = await connect();
  const message: WaitRequest = {
    session: input.session_id,
    cwd: input.cwd,
    request,
  };
  socket.write(`${JSON.stringify(message)}\n`);
  const reply = (await text(socket)).trim();
  if (reply === '') return 0;
  process.stderr.write(`${deliverySchema.parse(JSON.parse(reply)).text}\n`);
  return 2;
}

async function connect(): Promise<Socket> {
  const running = await tryConnect();
  if (running) return running;
  startRouter();
  const deadline = Date.now() + startTimeout;
  while (Date.now() < deadline) {
    await delay(200);
    const started = await tryConnect();
    if (started) return started;
  }
  throw new Error(
    `The notification router did not listen within ${startTimeout} ms.`,
  );
}

async function tryConnect(): Promise<Socket | undefined> {
  try {
    return await endpoint.address.connect();
  } catch (error) {
    if (error instanceof NoServerError) return undefined;
    throw error;
  }
}

function startRouter(): void {
  // The router outlives this session, and matches on Ezz's own Claude login:
  // it must not inherit this session's messaging token or another account's
  // OAuth token (lclaude sets CLAUDE_CODE_OAUTH_TOKEN).
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(CLAUDE|ANTHROPIC|CMUX)/.test(name),
    ),
  );
  spawn(process.execPath, [join(import.meta.dirname, 'main.js'), 'serve'], {
    cwd: homedir(),
    detached: true,
    env,
    stdio: 'ignore',
  }).unref();
}
