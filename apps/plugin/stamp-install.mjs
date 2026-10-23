// Gives the copy `install` adds a version of its own. ChatGPT keeps the
// Context Compiler page's HTML per plugin version, so a reinstall at the same
// version opens the last install's page against the new server; a new version
// makes it reload the page. Only the local install runs this: a release bumps
// the version.
import { readFileSync, writeFileSync } from 'node:fs';

const manifest =
  'dist/plugin-marketplace/plugins/context-compiler/.codex-plugin/plugin.json';
const plugin = JSON.parse(readFileSync(manifest, 'utf8'));
plugin.version = `${plugin.version}-dev.${Date.now()}`;
writeFileSync(manifest, `${JSON.stringify(plugin, null, 2)}\n`);
writeFileSync(
  'dist/plugin-marketplace/plugins/context-compiler/server/version.json',
  `${JSON.stringify({ version: plugin.version })}\n`,
);
