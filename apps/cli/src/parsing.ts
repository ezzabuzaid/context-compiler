import { fileURLToPath } from 'node:url';

import { Transcription } from '@workspace/connector/transcription';
import type { DocumentParser } from '@workspace/elt';
import { HillClimbing, LeaderFirst, Pool } from '@workspace/pool';
import { SpeechModels } from '@workspace/sdk-macos-speech-models';
import { VisionWorker } from '@workspace/source-apple-macos/vision';

// The OCR workers and the speech engine that read the files an import
// stores. The CLI starts them only for a command that reads files, so query,
// status and help start no native process.
export class Parsing implements AsyncDisposable {
  readonly #directory: string;
  #ocr: Pool<VisionWorker> | undefined;
  #transcription: Transcription | undefined;

  constructor(directory: string) {
    this.#directory = directory;
  }

  get parser(): DocumentParser {
    if (this.#transcription === undefined)
      throw new Error('Files are read only after Parsing.prepare()');
    return this.#transcription.parser;
  }

  async prepare(): Promise<void> {
    await this.#started().refresh();
  }

  async configure(id: string | null): Promise<void> {
    await this.#started().configure(id);
  }

  #started(): Transcription {
    if (this.#transcription !== undefined) return this.#transcription;
    // The server builds the same pool: change both.
    const ocr = new Pool({
      size: new HillClimbing({ memoryPerWorker: VisionWorker.memory }),
      startup: new LeaderFirst(),
      create: () =>
        new VisionWorker(
          fileURLToPath(
            import.meta.resolve('@workspace/source-apple-macos/vision-worker'),
          ),
        ),
    });
    this.#ocr = ocr;
    this.#transcription = new Transcription(
      this.#directory,
      new SpeechModels(),
      ocr,
      fileURLToPath(
        import.meta.resolve('@workspace/transcription-local/transcribe-local'),
      ),
    );
    return this.#transcription;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#transcription?.[Symbol.asyncDispose]();
    await this.#ocr?.[Symbol.asyncDispose]();
  }
}
