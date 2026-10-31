import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HillClimbing, LeaderFirst, Pool } from '@zukhruf/pool';

import { Transcription } from '@workspace/connector/transcription';
import type { DocumentParser } from '@workspace/elt';
import { SpeechModels } from '@workspace/sdk-macos-speech-models';
import { VisionWorker } from '@workspace/source-apple-macos/vision';

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
// CLI exits.
class Started implements AsyncDisposable {
  readonly #ocr: Pool<VisionWorker>;
  readonly transcription: Transcription;

  constructor(directory: string) {
    // The server builds the same pool: change both.
    this.#ocr = new Pool({
      size: new HillClimbing({ memoryPerWorker: VisionWorker.memory }),
      startup: new LeaderFirst(),
      create: () =>
        new VisionWorker(
          fileURLToPath(
            import.meta.resolve('@workspace/source-apple-macos/vision-worker'),
          ),
        ),
    });
    this.transcription = new Transcription(
      directory,
      new SpeechModels({
        hub: join(homedir(), '.cache/huggingface/hub'),
        home: homedir(),
      }),
      this.#ocr,
      fileURLToPath(
        import.meta.resolve('@workspace/transcription-local/transcribe-local'),
      ),
    );
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.transcription[Symbol.asyncDispose]();
    await this.#ocr[Symbol.asyncDispose]();
  }
}
