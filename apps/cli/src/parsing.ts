import { availableParallelism, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HillClimbing,
  IdleTimeout,
  LeaderFirst,
  Pool,
  PoolWorkers,
  computerStore,
} from '@zukhruf/pool';

import type { DocumentParser } from '@eltjs/elt';
import { SpeechModels } from '@eltjs/sdk-macos-speech-models';
import { VisionWorker } from '@eltjs/source-apple-macos/vision';
import {
  type VisionRead,
  type VisionText,
  visionKind,
} from '@eltjs/source-apple-macos/vision-kind';
import { Transcription } from '@workspace/connector/transcription';

// The OCR workers and the speech engine that read the files an import
// stores. The CLI starts them only for a command that reads files, so query,
// status and help start no native process.
export class Parsing implements AsyncDisposable {
  readonly #directory: string;
  #state: Idle | Started = new Idle();

  constructor(directory: string) {
    this.#directory = directory;
  }

  get parser(): DocumentParser {
    if (this.#state instanceof Started) return this.#state.transcription.parser;
    throw new Error('Files are read only after Parsing.prepare()');
  }

  async prepare(): Promise<void> {
    await this.#started().refresh();
  }

  async configure(id: string | null): Promise<void> {
    await this.#started().configure(id);
  }

  #started(): Transcription {
    if (this.#state instanceof Started) return this.#state.transcription;
    const started = new Started(this.#directory);
    this.#state = started;
    return started.transcription;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#state[Symbol.asyncDispose]();
  }
}

// No command has read a file yet: nothing runs.
class Idle implements AsyncDisposable {
  async [Symbol.asyncDispose](): Promise<void> {}
}

// A command reads files: the OCR workers and the speech engine run until the
// CLI exits. They are workers of the pools of the computer, so the CLI and
// the servers on this Mac share them, and the owner that the election picks
// runs every read.
class Started implements AsyncDisposable {
  readonly #visionWorkers: PoolWorkers<VisionRead, VisionText>;
  readonly #ocr: Pool<VisionRead, VisionText>;
  readonly transcription: Transcription;

  constructor(directory: string) {
    const store = computerStore(process.env);
    this.#visionWorkers = new PoolWorkers({
      kind: visionKind,
      store,
      clock: globalThis,
      size: new HillClimbing({
        memoryPerWorker: VisionWorker.memory,
        computer: {
          availableParallelism,
          availableMemory: () => process.availableMemory(),
        },
      }),
      startup: new LeaderFirst(),
      // Idle Vision workers close after 5 minutes, so a sync watch that waits for
      // changes holds no helpers between passes (#3516).
      eviction: new IdleTimeout({ after: 300_000 }),
      create: () =>
        new VisionWorker(
          fileURLToPath(
            import.meta.resolve('@eltjs/source-apple-macos/vision-worker'),
          ),
          globalThis,
        ),
    });
    this.#ocr = new Pool({ kind: visionKind, store, clock: globalThis });
    this.transcription = new Transcription(
      directory,
      new SpeechModels({
        hub: join(homedir(), '.cache/huggingface/hub'),
        home: homedir(),
      }),
      this.#ocr,
      fileURLToPath(
        import.meta.resolve('@eltjs/transcription-local/transcribe-local'),
      ),
      store,
      globalThis,
    );
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.transcription[Symbol.asyncDispose]();
    await this.#ocr[Symbol.asyncDispose]();
    await this.#visionWorkers[Symbol.asyncDispose]();
  }
}
