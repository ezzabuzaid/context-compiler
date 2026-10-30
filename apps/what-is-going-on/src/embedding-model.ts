import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Llama.app: the one place that serves this Mac's local models.
const llamaApp = createOpenAICompatible({
  name: 'llama.cpp',
  baseURL: 'http://127.0.0.1:9931/v1',
});

// EmbeddingGemma 2, which @zukhruf/event-grouping's design 3152b was fitted
// with.
const model: ReturnType<typeof llamaApp.embeddingModel> =
  llamaApp.embeddingModel('ggml-org/embeddinggemma-2-GGUF:Q8_0');

export default model;
