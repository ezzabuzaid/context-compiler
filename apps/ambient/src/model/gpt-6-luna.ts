import { codex } from '@deepagents/experimental/providers/codex';

// GPT-6-Luna, through the ChatGPT login of Codex (CODEX_HOME/auth.json, or
// ~/.codex/auth.json). Each change of the warehouse is one turn, so Ezz chose
// Luna over Sol to keep the subscription's quota, as websets does
// (2026-11-07); gpt-6.1-luna is not served to a ChatGPT login.
export default codex('gpt-6-luna');
