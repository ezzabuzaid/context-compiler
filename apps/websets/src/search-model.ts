import { codex } from '@deepagents/experimental/providers/codex';

// GPT-6-Luna searches the web for the pages of a collection, with OpenAI's
// web_search tool, through the ChatGPT login of Codex. gpt-6.1-luna is not
// served to a ChatGPT login.
export default codex('gpt-6-luna');
