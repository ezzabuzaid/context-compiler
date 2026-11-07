import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai';

// The Mac mini's llama.cpp router, which serves LFM3-Omni-2B over Tailscale
// and loads it on the first call.
const provider = createOpenAICompatible({
  name: 'liquid-local',
  baseURL: 'http://mac-mini.tailf1764a.ts.net:9931/v1',
  includeUsage: true,
  supportsStructuredOutputs: true,
});

// Liquid's Omni model card recommends greedy decoding for text output.
const model: ReturnType<typeof wrapLanguageModel> = wrapLanguageModel({
  model: provider.chatModel('LiquidAI/LFM3-Omni-2B-GGUF:Q4_0'),
  middleware: defaultSettingsMiddleware({ settings: { temperature: 0 } }),
});

export default model;
