import type { DocumentParser } from '@workspace/elt';
import type { SpeechModels } from '@workspace/sdk-macos-speech-models';
import { Settings } from '@workspace/settings';
import { AudioFormat } from '@workspace/source-apple-macos/audio-format';
import { ImageFormat } from '@workspace/source-apple-macos/image-format';
import { MacOSDocumentParser } from '@workspace/source-apple-macos/macos-document-parser';
import type { Vision } from '@workspace/source-apple-macos/vision';
import { LocalTranscriptionModel } from '@workspace/transcription-local';

// The hosts share the user's saved choice: the file name of a speech model,
// which each host finds wherever it is installed on its own Mac. Each host
// owns its model process; refresh notices choices another CLI or plugin
// process saved in the same store.
export class Transcription implements AsyncDisposable {
  readonly #settings: Settings;
  readonly #models: SpeechModels;
  #closing = Promise.resolve();
  #loading = Promise.resolve();
  readonly #helper: string | undefined;
  #chosen: string | null | undefined = null;
  #model: LocalTranscriptionModel | undefined;
  readonly #image: ImageFormat;
  #parser: DocumentParser;

  constructor(
    directory: string,
    models: SpeechModels,
    vision: Vision,
    helper?: string,
  ) {
    this.#settings = new Settings(directory);
    this.#models = models;
    this.#helper = helper;
    this.#image = new ImageFormat(vision);
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
    const previous = this.#model;
    this.#model =
      configuration === undefined
        ? undefined
        : new LocalTranscriptionModel(configuration, this.#helper);
    this.#parser = new MacOSDocumentParser([
      this.#image,
      ...(this.#model === undefined ? [] : [new AudioFormat(this.#model)]),
    ]);
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
      const model = installed.find((candidate) => candidate.id === id);
      if (model === undefined)
        throw new Error(
          `No speech model ${id} is installed on this Mac. Installed: ${installed.map((candidate) => candidate.id).join(', ') || 'none'}.`,
        );
      await using candidate = new LocalTranscriptionModel(
        model.configuration,
        this.#helper,
      );
      await candidate.check();
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
      await Promise.all([this.#closing, this.#model?.[Symbol.asyncDispose]()]);
    } finally {
      this.#settings[Symbol.dispose]();
    }
  }
}
