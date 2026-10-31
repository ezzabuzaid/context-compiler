import { claude } from '@deepagents/experimental/providers/claude';

// Claude Haiku 5.5 reads the offers of each program page. The provider sends
// the token in CLAUDE_CODE_OAUTH_TOKEN, or else the Claude Code login of this
// Mac.
export default claude('claude-haiku-5-5');
