import { codex } from '@deepagents/experimental/providers/codex';

// GPT-6-Luna judges each page on each criterion of a dataset and extracts
// its fields, through the ChatGPT login of Codex (CODEX_HOME/auth.json, or
// ~/.codex/auth.json). A dataset makes a call for each page, criterion
// and field, so Ezz chose the latest Luna or Terra over Sol, to keep the
// subscription's quota (2026-11-02); gpt-6.1-luna is not served to a ChatGPT
// login.
export default codex('gpt-6-luna');
