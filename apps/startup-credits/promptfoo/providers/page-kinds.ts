import type {
  ApiProvider,
  CallApiContextParams,
  CallApiOptionsParams,
  ProviderOptions,
  ProviderResponse,
} from 'promptfoo';
import { z } from 'zod';

import { PageKinds } from '../../src/rules/page-kinds.ts';

// The harness under test: the app's PageKinds rule, as the app runs it on a
// stored page (it reads the page as a loaded row, then Jev decides its kind
// through OpenRouter's Decisions API). A test gives the frozen page in its
// vars: its URL, title and text.
const varsSchema = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
});

// The columns that the rule gives for a page: the chosen kind, and Jev's
// whole answer as JSON.
const decidedSchema = z.object({ kind: z.string(), answer: z.string() });

export default class PageKindsProvider implements ApiProvider {
  readonly label: string | undefined;
  readonly #rule = new PageKinds();

  constructor(options: ProviderOptions) {
    this.label = options.label;
  }

  id() {
    return 'page-kinds';
  }

  async callApi(
    _prompt: string,
    context?: CallApiContextParams,
    options?: CallApiOptionsParams,
  ): Promise<ProviderResponse> {
    const page = varsSchema.parse(context?.vars);
    const row = this.#rule.read({
      articleUrl: page.url,
      title: page.title,
      textContent: page.text,
    });
    if (row === null) throw new Error(`PageKinds cannot read ${page.url}`);
    // The version of the harness that answered: its model and a hash of its
    // question. Each run is compared with a baseline run, so each row names
    // the harness that gave it.
    const metadata = { harness: await this.#rule.identity() };
    // A rejected key throws, as it fails the app's dataset: the row is an
    // error, which --retry-errors runs again.
    const [result] = await this.#rule.compute(
      [row.input],
      options?.abortSignal,
    );
    // A page whose call failed answers the label "null": promptfoo does not
    // grade a row with no output, so its label would leave the denominators.
    if (result !== undefined && 'error' in result)
      return {
        metadata: { ...metadata, failed: result.error },
        output: 'null',
      };
    if (result === undefined || !('value' in result))
      throw new Error(`PageKinds gave no kind for ${page.url}`);
    const { kind, answer } = decidedSchema.parse(result.value);
    return { metadata: { ...metadata, answer }, output: kind };
  }
}
