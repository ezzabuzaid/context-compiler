import { type Clock, Latch } from '@zukhruf/async';
import { Fixed, IdleTimeout, Parallel, Pool } from '@zukhruf/pool';

import type { DocumentParser } from '@eltjs/elt';
import type { SpeechModels } from '@eltjs/sdk-macos-speech-models';
import { AudioFormat } from '@eltjs/source-apple-macos/audio-format';
import type { DocumentFormat } from '@eltjs/source-apple-macos/document-format';
import { ImageFormat } from '@eltjs/source-apple-macos/image-format';
import { MacOSDocumentParser } from '@eltjs/source-apple-macos/macos-document-parser';
import type { VisionWorker } from '@eltjs/source-apple-macos/vision';
import { LocalTranscriptionModel } from '@eltjs/transcription-local';
import { TranscriptionWorker } from '@eltjs/transcription-local/transcription-worker';
import { Settings } from '@workspace/settings';

// The hosts share the user's saved choice: the file name of a speech model,
// which each host finds wherever it is installed on its own Mac. Each host
// owns its OCR pool; this owns the pool of the chosen model's engine, which
// loads the weights as soon as the model is chosen. refresh notices choices
// another CLI or plugin process saved in the same store.
export class Transcription implements AsyncDisposable {
  readonly #settings: Settings;
  readonly #models: SpeechModels;
  readonly #helper: string;
  #choice: Loading | Loaded | Failed = new Loaded(null);
  #engines: Pool<TranscriptionWorker> | NoEngines = new NoEngines();
  // The closes of the engine pools that a later choice replaced. A failed
  // close stays, so refresh and disposal report it.
  readonly #closings = new Set<Latch<Outcome>>();
  readonly #image: ImageFormat;
  readonly #clock: Clock & { readonly Date: { now(): number } };
  #parser: DocumentParser;

  constructor(
    directory: string,
    models: SpeechModels,
    ocr: Pool<VisionWorker>,
    helper: string,
    // The clock of the engines' pool and of each transcription: an app gives
    // globalThis.
    clock: Clock & { readonly Date: { now(): number } },
  ) {
    this.#settings = new Settings(directory);
    this.#models = models;
    this.#helper = helper;
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
    if (choice instanceof Loading) {
      const outcome = await choice.done.wait();
      if (!outcome.ok) throw outcome.error;
    }
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
        loading.done.open({ ok: true });
        return;
      }
      const previous = this.#engines;
      this.#engines = new NoEngines();
      const formats: DocumentFormat[] = [this.#image];
      if (configuration !== undefined) {
        const engines = new Pool({
          size: new Fixed(1),
          startup: new Parallel(),
          // The engine holds the model's weights; it closes after 5 idle
          // minutes and the next audio loads it again.
          eviction: new IdleTimeout({ after: 300_000 }),
          create: () => new TranscriptionWorker(this.#helper, configuration),
          clock: this.#clock,
        });
        this.#engines = engines;
        formats.push(
          new AudioFormat(
            new LocalTranscriptionModel(configuration, engines, this.#clock),
          ),
        );
      }
      this.#parser = new MacOSDocumentParser(formats);
      this.#choice = new Loaded(loading.chosen);
      if (previous instanceof Pool) this.#close(previous);
      loading.done.open({ ok: true });
    } catch (error) {
      if (this.#choice === loading) this.#choice = new Failed();
      loading.done.open({ ok: false, error });
    }
  }

  #close(engines: Pool<TranscriptionWorker>): void {
    const closed = new Latch<Outcome>();
    this.#closings.add(closed);
    engines[Symbol.asyncDispose]().then(
      () => {
        this.#closings.delete(closed);
        closed.open({ ok: true });
      },
      (error: unknown) => closed.open({ ok: false, error }),
    );
  }

  async #closed(): Promise<void> {
    for (const outcome of await Promise.all(
      [...this.#closings].map((closed) => closed.wait()),
    ))
      if (!outcome.ok) throw outcome.error;
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
        engines instanceof Pool ? engines[Symbol.asyncDispose]() : undefined,
      ]);
    } finally {
      this.#settings[Symbol.dispose]();
    }
  }
}

type Outcome =
  { readonly ok: true } | { readonly ok: false; readonly error: unknown };

// A search for the chosen model; done opens with how it ended.
class Loading {
  readonly chosen: string | null;
  readonly done = new Latch<Outcome>();

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
