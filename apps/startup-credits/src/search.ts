import { openai } from '@ai-sdk/openai';
import { Output, generateText } from 'ai';
import { z } from 'zod';

import model from './search-model.ts';

// A page that a search found, and the company whose program it is.
export type Found = { readonly url: string; readonly company: string };

const answerSchema = z.object({
  pages: z.array(z.object({ url: z.string(), company: z.string() })),
});

const instructions =
  "You find the web pages of startup programs. Use web search. List the official page of each program that meets every criterion, on the company's own website, at most 20, the best first. A page that lists the programs of many companies, a news article or a blog post is not a program page.";

// The program pages that a web search finds for the criteria of a query,
// best first: the starting URLs that the crawl then reads. A URL that is not
// http or https is no page, and a page is listed once.
export async function search(
  criteria: readonly string[],
  signal: AbortSignal,
): Promise<readonly Found[]> {
  const { output } = await generateText({
    model,
    instructions,
    prompt: `Criteria:\n${criteria.map((criterion) => `- ${criterion}`).join('\n')}`,
    tools: { web_search: openai.tools.webSearch({}) },
    output: Output.object({ schema: answerSchema }),
    abortSignal: signal,
  });
  const found = new Map<string, Found>();
  for (const { url, company } of output.pages) {
    const page = URL.parse(url);
    if (page === null || !['http:', 'https:'].includes(page.protocol)) {
      continue;
    }
    page.hash = '';
    if (!found.has(page.href)) {
      found.set(page.href, { url: page.href, company });
    }
  }
  return [...found.values()];
}
