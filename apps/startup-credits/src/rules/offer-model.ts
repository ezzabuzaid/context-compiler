import { codex } from '@deepagents/experimental/providers/codex';

// GPT-6-Luna reads the offers of each program page through the ChatGPT login
// of Codex (CODEX_HOME/auth.json, or ~/.codex/auth.json). On the labelled
// test pages it found 75-77% of the offers where Claude Haiku 5.5 found
// 65-66%, at the same precision on program pages (#3561).
export default codex('gpt-6-luna');
