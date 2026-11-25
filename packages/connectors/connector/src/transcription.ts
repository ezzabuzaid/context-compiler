import { Future, WaitGroup, type WallClock } from '@zukhruf/async';
import { Fixed, IdleTimeout, Parallel, Pool, PoolWorkers } from '@zukhruf/pool';

import type { DocumentParser } from '@eltjs/elt';
import type { SpeechModels } from '@eltjs/sdk-macos-speech-models';
import { AudioFormat } from '@eltjs/source-apple-macos/audio-format';
import type { DocumentFormat } from '@eltjs/source-apple-macos/document-format';
import { ImageFormat } from '@eltjs/source-apple-macos/image-format';
import { MacOSDocumentParser } from '@eltjs/source-apple-macos/macos-document-parser';
import type {
  VisionRead,
  VisionText,
} from '@eltjs/source-apple-macos/vision-kind';
import {
  type LocalTranscriptionConfiguration,
  LocalTranscriptionModel,
} from '@eltjs/transcription-local';
import {
  type Transcript,
  type TranscriptionRead,
  transcriptionKind,
} from '@eltjs/transcription-local/transcription-kind';
import { TranscriptionWorker } from '@eltjs/transcription-local/transcription-worker';
import { Settings } from '@workspace/settings';

// The hosts share the user's saved choice: the file name of a speech model,
// which each host finds wherever it is installed on its own Mac. Each host
// builds its Vision pool; this builds the pool of the chosen model's engine
// on the store of the computer, so the hosts that chose the same model share
// one engine, which loads the weights as soon as the model is chosen.
// refresh notices choices another CLI process saved in the same settings.
export class Transcription implements AsyncDisposable {
  readonly #settings: Settings;
  readonly #models: SpeechModels;
  readonly #helper: string;
  #choice: Loading | Loaded | Failed = new Loaded(null);
  #engines: Engines | NoEngines = new NoEngines();
  // The closes of the engine pools that a later choice replaced, and the
  // closes that failed: a failure stays, so refresh and disposal report it.
  readonly #closings = new WaitGroup();
  readonly #failedClosings: unknown[] = [];
  readonly #image: ImageFormat;
  readonly #store: string;
  readonly #clock: WallClock;
  #parser: DocumentParser;

  constructor(
    directory: string,
    models: SpeechModels,
    ocr: Pool<VisionRead, VisionText>,
    helper: string,
    // The store of the engines' pool: an app gives computerStore(process.env).
    store: string,
    // The clock of the engines' pool and of each transcription: an app gives
    // globalThis.
    clock: WallClock,
  ) {
    this.#settings = new Settings(directory);
    this.#models = models;
    this.#helper = helper;
    this.#store = store;
    this.#clock = clock;
    this.#image = new ImageFormat(ocr);
    this.#parser = new MacOSDocumentParser([this.#image]);
  }

  get parser(): DocumentParser {
    this.#reload();
    return this.#parser;
  }

  async refresh(): Promise<void> {
    this.#reload();
    const choice = this.#choice;
    if (choice instanceof Loading) await choice.done.wait();
    await this.#closed();
  }

  // A long-running CLI watch must see choices saved by another host too.
  // Finding the chosen model takes a search, so files keep the previous
  // parser until it is found; each file takes one parser snapshot, so its
  // identity and text agree. A model not installed on this Mac reads no
  // audio, as when transcription is off.
  #reload(): void {
    const chosen = this.#settings.transcription();
    const choice = this.#choice;
    // After a failed search, the next read searches again, and refresh
    // reports the failure.
    if (!(choice instanceof Failed) && choice.chosen === chosen) return;
    const loading = new Loading(chosen);
    this.#choice = loading;
    // A read through the parser getter does not wait for the search.
    void this.#load(loading);
  }

  async #load(loading: Loading): Promise<void> {
    try {
      const configuration =
        loading.chosen === null
          ? undefined
          : (await this.#models.find(loading.chosen))?.configuration;
      if (this.#choice !== loading) {
        loading.done.resolve();
        return;
      }
      const previous = this.#engines;
      this.#engines = new NoEngines();
      const formats: DocumentFormat[] = [this.#image];
      if (configuration !== undefined) {
        const engines = new Engines(
          configuration,
          this.#helper,
          this.#store,
          this.#clock,
        );
        this.#engines = engines;
        formats.push(
          new AudioFormat(
            new LocalTranscriptionModel(
              configuration,
              engines.pool,
              this.#clock,
            ),
          ),
        );
      }
      this.#parser = new MacOSDocumentParser(formats);
      this.#choice = new Loaded(loading.chosen);
      if (previous instanceof Engines) void this.#close(previous);
      loading.done.resolve();
    } catch (error) {
      if (this.#choice === loading) this.#choice = new Failed();
      loading.done.reject(error);
    }
  }

  async #close(engines: Engines): Promise<void> {
    using _closing = this.#closings.add();
    try {
      await engines[Symbol.asyncDispose]();
    } catch (error) {
      this.#failedClosings.push(error);
    }
  }

  async #closed(): Promise<void> {
    await this.#closings.wait({ signal: undefined });
    if (this.#failedClosings.length > 0) throw this.#failedClosings[0];
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
      const engines = this.#engines;
      await Promise.all([
        this.#closed(),
        engines instanceof Engines ? engines[Symbol.asyncDispose]() : undefined,
      ]);
    } finally {
      this.#settings[Symbol.dispose]();
    }
  }
}

// The engine of one chosen model: this host offers one engine for the
// model's kind, and sends its audio to the pool of that kind.
class Engines implements AsyncDisposable {
  readonly pool: Pool<TranscriptionRead, Transcript>;
  readonly #workers: PoolWorkers<TranscriptionRead, Transcript>;

  constructor(
    configuration: LocalTranscriptionConfiguration,
    helper: string,
    store: string,
    clock: WallClock,
  ) {
    const kind = transcriptionKind(configuration);
    this.#workers = new PoolWorkers({
      kind,
      store,
      clock,
      size: new Fixed(1),
      startup: new Parallel(),
      // The engine holds the model's weights; it closes after 5 idle minutes
      // and the next audio loads it again.
      eviction: new IdleTimeout({ after: 300_000 }),
      create: () => new TranscriptionWorker(helper, configuration),
    });
    this.pool = new Pool({ kind, store, clock });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    try {
      await this.pool[Symbol.asyncDispose]();
    } finally {
      await this.#workers[Symbol.asyncDispose]();
    }
  }
}

// A search for the chosen model; done ends as the search ends.
class Loading {
  readonly chosen: string | null;
  readonly done = new Future<void>();

  constructor(chosen: string | null) {
    this.chosen = chosen;
  }
}

// The parser reads with the chosen model, or with no model when chosen is
// null or the model is not installed on this Mac.
class Loaded {
  readonly chosen: string | null;

  constructor(chosen: string | null) {
    this.chosen = chosen;
  }
}

// The last search failed: the next read searches again.
class Failed {}

// Transcription is off, or the chosen model is not installed on this Mac.
class NoEngines {}
