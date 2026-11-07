import { openai } from '@ai-sdk/openai';
import { Output, generateText } from 'ai';
import { z } from 'zod';

import model from './search-model.ts';

// A page that a search found.
export type Found = { readonly url: string };

const answerSchema = z.object({
  pages: z.array(z.object({ url: z.string() })),
});

const instructions =
  'You find web pages. Use web search. List the pages that the query asks for, and that meet every criterion when criteria are given, the best first. Give the page itself, not a search result page, and each page once.';

// The pages that a web search finds for a query, best first; a dataset also
// gives its criteria. A URL that is not http or https is no page, and a page
// is listed once.
export async function search(
  {
    query,
    count,
    criteria,
  }: {
    readonly query: string;
    readonly count: number;
    readonly criteria: readonly string[];
  },
  signal: AbortSignal,
): Promise<readonly Found[]> {
  const lines = [`Query: ${query}`, `At most ${count} pages.`];
  if (criteria.length > 0) {
    lines.push('Criteria:', ...criteria.map((criterion) => `- ${criterion}`));
  }
  const { output } = await generateText({
    model,
    instructions,
    prompt: lines.join('\n'),
    tools: { web_search: openai.tools.webSearch({}) },
    output: Output.object({ schema: answerSchema }),
    abortSignal: signal,
  });
  const found = new Map<string, Found>();
  for (const { url } of output.pages) {
    const page = URL.parse(url);
    if (page === null || !['http:', 'https:'].includes(page.protocol)) {
      continue;
    }
    page.hash = '';
    if (!found.has(page.href)) {
      found.set(page.href, { url: page.href });
    }
  }
  return [...found.values()].slice(0, count);
}
