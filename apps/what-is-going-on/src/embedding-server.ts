import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { Coprocess } from '@zukhruf/coprocess';

// The local llama.cpp build and EmbeddingGemma 2 weights of research round
// #2938, which @zukhruf/event-grouping's design 3152b was fitted with.
const research = join(
  homedir(),
  '.codex/visualizations/2026/10/23/01a16a1c-424c-7793-8ca9-02cc1c715d82/embedding-heldout-2938',
);

// Starts llama-server with the arguments of event-grouping's eval README, and
// resolves once it answers /health. Disposing it stops the server (SIGTERM,
// then SIGKILL after five seconds).
export async function startEmbeddingServer(port: number) {
  const server = new Coprocess(
    join(research, 'runtime/llama-b11836/llama-server'),
    [
      '-m',
      join(research, 'models/embeddinggemma-2-Q8_0.gguf'),
      '--alias',
      'embeddinggemma-2',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '-c',
      '8192',
      '-np',
      '1',
      '-t',
      '2',
      '-tb',
      '2',
      '-b',
      '8192',
      '-ub',
      '2048',
      '--embedding',
    ],
    { name: 'llama-server' },
  );
  const stop = async () => {
    server.kill();
    await server.exited();
  };
  const origin = `http://127.0.0.1:${port}`;
  try {
    for (;;) {
      const answer = await Promise.race([
        fetch(`${origin}/health`).then(
          (response) => response.ok,
          () => false,
        ),
        server.exited(),
      ]);
      if (answer instanceof Error) throw answer;
      if (answer) break;
      await setTimeout(200);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { url: `${origin}/v1`, [Symbol.asyncDispose]: stop };
}
