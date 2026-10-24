import { tmpdir } from 'node:os';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { type BackendState, type PageToolParams } from './desktop-api.ts';

export class Backend {
  readonly #entry: string;
  readonly #changed: (state: BackendState) => void;
  #state: BackendState = { status: 'starting' };
  #client: Client | undefined;
  #transport: StdioClientTransport | undefined;
  #exited: Promise<void> | undefined;
  #starting: Promise<void> | undefined;
  #stopping = false;

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

  start(): Promise<void> {
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async #start(): Promise<void> {
    await this.#close();
    this.#stopping = false;
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
    const exited = Promise.withResolvers<void>();
    client.onclose = () => {
      exited.resolve();
      if (!this.#stopping && this.#state.status === 'ready')
        this.#setState({
          status: 'failed',
          message: ['The Context Compiler backend exited.', diagnostics.trim()]
            .filter(Boolean)
            .join('\n\n'),
        });
    };
    this.#client = client;
    this.#transport = transport;
    this.#exited = exited.promise;
    try {
      await client.connect(transport);
      this.#setState({ status: 'ready' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.#close();
      this.#setState({
        status: 'failed',
        message: diagnostics.trim() || message,
      });
    }
  }

  async callTool(params: PageToolParams, signal: AbortSignal, timeout: number) {
    if (this.#state.status !== 'ready' || this.#client === undefined)
      throw new Error('Context Compiler is not connected.');
    return CallToolResultSchema.parse(
      await this.#client.callTool(params, undefined, {
        timeout,
        signal,
      }),
    );
  }

  async #close(): Promise<void> {
    this.#stopping = true;
    const spawned =
      this.#transport?.pid !== null && this.#transport?.pid !== undefined;
    await this.#client?.close();
    // StdioClientTransport.close can return just after SIGKILL. Its onclose
    // notification follows the child's actual exit, including closed pipes.
    if (spawned) await this.#exited;
    this.#client = undefined;
    this.#transport = undefined;
  }

  async quit(): Promise<void> {
    await this.#starting;
    await this.#close();
  }
}
