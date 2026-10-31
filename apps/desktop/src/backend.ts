import { tmpdir } from 'node:os';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { Latch } from '@zukhruf/async';

import { type BackendState, type PageToolParams } from './desktop-api.ts';

export class Backend {
  readonly #entry: string;
  readonly #changed: (state: BackendState) => void;
  #state: BackendState = { status: 'starting' };
  #lifecycle: Stopped | Starting | Running | Stopping = new Stopped();

  constructor(entry: string, changed: (state: BackendState) => void) {
    this.#entry = entry;
    this.#changed = changed;
  }

  get state(): BackendState {
    return this.#state;
  }

  #setState(state: BackendState) {
    this.#state = state;
    this.#changed(state);
  }

  // Starts the backend once: a start while one runs waits for it, and fails
  // as it fails; a start while the backend closes waits for the close.
  async start(): Promise<void> {
    const lifecycle = this.#lifecycle;
    if (lifecycle instanceof Running) return;
    if (lifecycle instanceof Starting) {
      const outcome = await lifecycle.settled.wait();
      if (!outcome.ok) throw outcome.error;
      return;
    }
    if (lifecycle instanceof Stopping) {
      await lifecycle.closed.wait();
      return this.start();
    }
    const starting = new Starting();
    this.#lifecycle = starting;
    try {
      await this.#start();
      starting.settled.open({ ok: true });
    } catch (error) {
      this.#lifecycle = new Stopped();
      starting.settled.open({ ok: false, error });
      throw error;
    }
  }

  async #start(): Promise<void> {
    this.#setState({ status: 'starting' });
    const client = new Client({
      name: 'context-compiler-desktop',
      version: '1.0.0',
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [this.#entry],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        CONTEXT_COMPILER_GRANTEE: 'Context Compiler',
        TMPDIR: tmpdir(),
      },
      stderr: 'pipe',
    });
    let diagnostics = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-16_384);
    });
    const running = new Running(client, transport);
    client.onclose = () => {
      running.exited.open();
      // Only the backend that runs can exit unexpectedly: one that starts
      // or closes is handled where it starts or closes.
      if (this.#lifecycle !== running) return;
      this.#lifecycle = new Stopped();
      this.#setState({
        status: 'failed',
        message: ['The Context Compiler backend exited.', diagnostics.trim()]
          .filter(Boolean)
          .join('\n\n'),
      });
    };
    try {
      await client.connect(transport);
      this.#lifecycle = running;
      this.#setState({ status: 'ready' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await running.close();
      this.#lifecycle = new Stopped();
      this.#setState({
        status: 'failed',
        message: diagnostics.trim() || message,
      });
    }
  }

  async callTool(params: PageToolParams, signal: AbortSignal, timeout: number) {
    const lifecycle = this.#lifecycle;
    const running =
      lifecycle instanceof Stopping ? lifecycle.running : lifecycle;
    if (this.#state.status !== 'ready' || !(running instanceof Running))
      throw new Error('Context Compiler is not connected.');
    return CallToolResultSchema.parse(
      await running.client.callTool(params, undefined, {
        timeout,
        signal,
      }),
    );
  }

  // Waits for a start that runs, then closes the backend.
  async quit(): Promise<void> {
    const lifecycle = this.#lifecycle;
    if (lifecycle instanceof Starting) {
      const outcome = await lifecycle.settled.wait();
      if (!outcome.ok) throw outcome.error;
      return this.quit();
    }
    if (lifecycle instanceof Stopping) return lifecycle.closed.wait();
    if (lifecycle instanceof Stopped) return;
    const stopping = new Stopping(lifecycle);
    this.#lifecycle = stopping;
    try {
      await lifecycle.close();
    } finally {
      this.#lifecycle = new Stopped();
      stopping.closed.open();
    }
  }
}

// No backend process: before the first start, after a close, or after the
// process failed to start or exited.
class Stopped {}

// A start in progress; settled opens with how it ended.
class Starting {
  readonly settled = new Latch<
    { readonly ok: true } | { readonly ok: false; readonly error: unknown }
  >();
}

// A backend process and the client connected to it; exited opens once the
// process has exited and its pipes have closed.
class Running {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  readonly exited = new Latch();

  constructor(client: Client, transport: StdioClientTransport) {
    this.client = client;
    this.transport = transport;
  }

  async close(): Promise<void> {
    const spawned = this.transport.pid !== null;
    await this.client.close();
    // StdioClientTransport.close can return just after SIGKILL. Its onclose
    // notification follows the child's actual exit, including closed pipes.
    if (spawned) await this.exited.wait();
  }
}

// A backend the desktop closes on purpose: its exit is not a failure, and a
// tool call still reaches its client until the close ends.
class Stopping {
  readonly running: Running;
  readonly closed = new Latch();

  constructor(running: Running) {
    this.running = running;
  }
}
