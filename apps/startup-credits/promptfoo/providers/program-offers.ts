import type {
  ApiProvider,
  CallApiContextParams,
  CallApiOptionsParams,
  ProviderOptions,
  ProviderResponse,
} from 'promptfoo';
import { z } from 'zod';

import { ProgramOffers } from '../../src/rules/program-offers.ts';

// The harness under test: the app's ProgramOffers rule, as the app runs it
// on a stored page (the prompt, GPT-6-Luna through the Codex login, the
// grounding of each quote, and the removal of repeated offers). A test gives
// the page in its vars: the URL and the frozen page (title and text) from
// pages/.

// promptfoo gives a var from a file as the file's text, so the page comes
// as JSON text.
const varsSchema = z.object({
  url: z.string(),
  page: z
    .string()
    .transform((json): unknown => JSON.parse(json))
    .pipe(z.object({ title: z.string(), text: z.string() })),
});

export default class ProgramOffersProvider implements ApiProvider {
  readonly label: string | undefined;
  readonly #rule = new ProgramOffers();

  constructor(options: ProviderOptions) {
    this.label = options.label;
  }

  id() {
    return 'program-offers';
  }

  async callApi(
    _prompt: string,
    context?: CallApiContextParams,
    options?: CallApiOptionsParams,
  ): Promise<ProviderResponse> {
    const { url, page } = varsSchema.parse(context?.vars);
    // The version of the harness that answered: its model and a hash of its
    // prompt, schema and settings. Each run is compared with a baseline run,
    // so each row names the harness that gave it.
    const metadata = { harness: await this.#rule.identity() };
    const outcome = await this.#rule.outcome(
      { url, title: page.title, text: page.text },
      options?.abortSignal,
    );
    if ('failed' in outcome) return { error: outcome.failed, metadata };
    // An invalid answer is the harness's output, not an error: the
    // assertion reads its text as json.loads reads it and scores it as
    // invalid, and its expected offers stay in the denominators (#3762). The
    // AI SDK keeps no text for an answer that never came.
    if ('invalid' in outcome)
      return {
        metadata: { ...metadata, invalid: outcome.invalid },
        output: outcome.invalid.text ?? null,
      };
    return { metadata, output: { offers: outcome.offers } };
  }
}
