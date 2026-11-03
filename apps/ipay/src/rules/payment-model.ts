import { codex } from '@deepagents/experimental/providers/codex';

// GPT-6-Luna reads the payments of each email through the ChatGPT login of
// Codex (CODEX_HOME/auth.json, or ~/.codex/auth.json), the model that found
// the most offers on startup-credits' labelled pages (#3561).
export default codex('gpt-6-luna');
