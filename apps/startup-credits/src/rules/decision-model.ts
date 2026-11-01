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
