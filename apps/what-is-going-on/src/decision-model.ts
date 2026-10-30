import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';

// The Mac mini's llama.cpp, which serves the decision models over Tailscale.
// The provider needs a key; llama.cpp ignores it.
const macMini = createTypeSafeAi({
  baseURL: 'http://mac-mini.tailf1764a.ts.net:9931/v1',
  apiKey: 'none',
});

// Liquid AI's d1-2B, the decision model that @zukhruf/relevance-filtering's
// research rounds 13 and 14 measured (#3383).
const model: ReturnType<typeof macMini.decisionModel> = macMini.decisionModel(
  'LiquidAI/d1-2B-GGUF:Q8_0',
);

export default model;
