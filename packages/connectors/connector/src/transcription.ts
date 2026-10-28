import { Fixed, Parallel, Pool } from '@zukhruf/pool';

import type { DocumentParser } from '@workspace/elt';
import type { SpeechModels } from '@workspace/sdk-macos-speech-models';
import { Settings } from '@workspace/settings';
import { AudioFormat } from '@workspace/source-apple-macos/audio-format';
import type { DocumentFormat } from '@workspace/source-apple-macos/document-format';
import { ImageFormat } from '@workspace/source-apple-macos/image-format';
import { MacOSDocumentParser } from '@workspace/source-apple-macos/macos-document-parser';
import type { VisionWorker } from '@workspace/source-apple-macos/vision';
import { LocalTranscriptionModel } from '@workspace/transcription-local';
import { TranscriptionWorker } from '@workspace/transcription-local/transcription-worker';

// The hosts share the user's saved choice: the file name of a speech model,
// which each host finds wherever it is installed on its own Mac. Each host
// owns its OCR pool; this owns the pool of the chosen model's engine, which
// loads the weights as soon as the model is chosen. refresh notices choices
// another CLI or plugin process saved in the same store.
export class Transcription implements AsyncDisposable {
  readonly #settings: Settings;
  readonly #models: SpeechModels;
  #closing = Promise.resolve();
  #loading = Promise.resolve();
  readonly #helper: string;
  #chosen: string | null | undefined = null;
  #engines: Pool<TranscriptionWorker> | undefined;
  readonly #image: ImageFormat;
  #parser: DocumentParser;

  constructor(
    directory: string,
    models: SpeechModels,
    ocr: Pool<VisionWorker>,
    helper: string,
  ) {
    this.#settings = new Settings(directory);
    this.#models = models;
    this.#helper = helper;
    this.#image = new ImageFormat(ocr);
    this.#parser = new MacOSDocumentParser([this.#image]);
  }

  get parser(): DocumentParser {
    this.#reload();
    return this.#parser;
  }

  async refresh(): Promise<void> {
    this.#reload();
    await this.#loading;
    await this.#closing;
  }

  // A long-running CLI watch must see choices saved by another host too.
  // Finding the chosen model takes a search, so files keep the previous
  // parser until it is found; each file takes one parser snapshot, so its
  // identity and text agree. A model not installed on this Mac reads no
  // audio, as when transcription is off.
  #reload(): void {
    const chosen = this.#settings.transcription();
    if (chosen === this.#chosen) return;
    this.#chosen = chosen;
    this.#loading = this.#load(chosen).catch((error: unknown) => {
      // The next read searches again, and refresh reports the failure.
      if (this.#chosen === chosen) this.#chosen = undefined;
      throw error;
    });
    // A read through the parser getter does not wait for the search.
    this.#loading.catch(() => undefined);
  }

  async #load(chosen: string | null): Promise<void> {
    const configuration =
      chosen === null
        ? undefined
        : (await this.#models.find(chosen))?.configuration;
    if (chosen !== this.#chosen) return;
    const previous = this.#engines;
    this.#engines = undefined;
    const formats: DocumentFormat[] = [this.#image];
    if (configuration !== undefined) {
      const engines = new Pool({
        size: new Fixed(1),
        startup: new Parallel(),
        create: () => new TranscriptionWorker(this.#helper, configuration),
      });
      this.#engines = engines;
      formats.push(
        new AudioFormat(new LocalTranscriptionModel(configuration, engines)),
      );
    }
    this.#parser = new MacOSDocumentParser(formats);
    if (previous !== undefined)
      this.#closing = Promise.all([
        this.#closing,
        previous[Symbol.asyncDispose](),
      ]).then(() => undefined);
  }

  // Saves the installed model with this file name, or null to stop
  // transcribing.
  async configure(id: string | null): Promise<void> {
    if (id !== null) {
      const installed = await this.#models.list();
      if (!installed.some((candidate) => candidate.id === id))
        throw new Error(
          `No speech model ${id} is installed on this Mac. Installed: ${installed.map((candidate) => candidate.id).join(', ') || 'none'}.`,
        );
      await TranscriptionWorker.check(this.#helper);
    }
    this.#settings.setTranscription(id);
    await this.refresh();
  }

  async choices() {
    return {
      selected: this.#settings.transcription(),
      models: (await this.#models.list()).map(({ id, title }) => ({
        id,
        title,
      })),
    };
  }

  async [Symbol.asyncDispose](): Promise<void> {
    try {
      await Promise.all([
        this.#closing,
        this.#engines?.[Symbol.asyncDispose](),
      ]);
    } finally {
      this.#settings[Symbol.dispose]();
    }
  }
}
