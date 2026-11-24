import { mkdirSync } from 'node:fs';

import { SqliteElection } from '@zukhruf/election';
import { Shutdown } from '@zukhruf/shutdown';

import { log } from './log.ts';
import { endpoint, stateFolder } from './places.ts';
import { Router } from './router.ts';

/**
 * The router daemon. The first wait starts it, and it exits once no session
 * has waited for five minutes. Two waits that start it at once elect one.
 */
export async function serve(): Promise<void> {
  using shutdown = new Shutdown();
  mkdirSync(stateFolder, { recursive: true, mode: 0o700 });
  const election = new SqliteElection({
    clock: globalThis,
    directory: stateFolder,
    claimFile: 'router.lock',
    epochFile: 'router.epoch',
  });
  await using term = await election.campaign();
  if (term === undefined) return;
  const router = new Router();
  await using server = await endpoint.listen((socket) => router.accept(socket));
  log('started', {
    epoch: String(term.epoch),
    socket: server.endpoint.address.path,
  });
  try {
    await router.run(shutdown.signal);
  } catch (error) {
    log('failed', { error: String(error) });
    throw error;
  } finally {
    // The server's close waits for open connections, and each wait is one.
    router.close();
    log('stopped', {});
  }
}
