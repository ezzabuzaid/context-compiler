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
// the frozen page in its vars: its URL, title and text.
const varsSchema = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
});

// The answer of a page whose call failed or whose answer has no text: the
// text "null", which the assertion reads as an invalid record, as SOB's
// runner keeps None. promptfoo does not grade a row with no output, so its
// expected offers would leave the denominators and raise recall.
const nothing = 'null';

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
    const page = varsSchema.parse(context?.vars);
    // The version of the harness that answered: its model and a hash of its
    // prompt, schema and settings. Each run is compared with a baseline run,
    // so each row names the harness that gave it.
    const metadata = { harness: await this.#rule.identity() };
    const outcome = await this.#rule.outcome(page, options?.abortSignal);
    if ('failed' in outcome)
      return {
        metadata: { ...metadata, failed: outcome.failed },
        output: nothing,
      };
    // An invalid answer is the harness's output, not an error: the
    // assertion reads its text as json.loads reads it and scores it as
    // invalid, and its expected offers stay in the denominators (#3762). The
    // AI SDK keeps no text for an answer that never came.
    if ('invalid' in outcome)
      return {
        metadata: { ...metadata, invalid: outcome.invalid },
        output: outcome.invalid.text ?? nothing,
      };
    return { metadata, output: { offers: outcome.offers } };
  }
}
