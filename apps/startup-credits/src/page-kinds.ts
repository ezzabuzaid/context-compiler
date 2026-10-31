import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';

// A decision model of OpenRouter's Decisions API, by its id. The API speaks
// TypeSafe's wire format at /decisions. OpenRouter's own provider (3.1.0)
// types its model against an older decision spec than ai 7, so the TypeSafe
// provider is pointed at it instead.
export function openRouterDecisionModel(id: string) {
  return createTypeSafeAi({
    baseURL: 'https://openrouter.ai/api/alpha',
    apiKey: process.env.OPENROUTER_API_KEY,
    fetch: (url, init) =>
      fetch(String(url).replace(/\/systemone$/u, '/decisions'), init),
  }).decisionModel(id);
}

// The kinds of page that a list of startup programs links.
export const pageKinds = [
  'program',
  'home',
  'list',
  'article',
  'other_program',
  'investor',
  'other',
] as const;

// The question that labels a page, with one criterion for each kind. The
// page-kind benchmark (eval/) asks the same question.
export const pageKindQuestions = {
  kind: {
    type: 'choice',
    instructions: 'What kind of web page is this?',
    criteria: {
      program: "one company's program page for startups",
      home: "a company's home page or product page",
      list: 'a list or directory of many programs from many companies',
      article: 'a blog post, news article or documentation page',
      other_program: 'a program for students, open source or ambassadors',
      investor: 'a venture fund, investor or accelerator',
      other:
        'a sign-in wall, loading screen, error page or a page with almost no text',
    } satisfies Record<(typeof pageKinds)[number], string>,
  },
} as const;

// What the model reads of a page: its URL, its title and its text, at most
// 20,000 characters. ArticleExtractor gives no title for some pages
// (source-web-pages article-extractor.ts: title is nullable text).
export function pageState(url: string, title: string | null, text: string) {
  return `URL: ${url}\nTitle: ${title ?? ''}\n\n${text}`.slice(0, 20_000);
}
