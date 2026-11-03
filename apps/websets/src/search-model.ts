import { codex } from '@deepagents/experimental/providers/codex';

// GPT-6.1-Terra searches the web for the pages of a collection, with OpenAI's
// web_search tool, through the ChatGPT login of Codex. Ezz chose the latest
// Luna or Terra over Sol, to keep the subscription's quota (2026-11-02); a
// search makes few calls, so it takes Terra.
export default codex('gpt-6.1-terra');
