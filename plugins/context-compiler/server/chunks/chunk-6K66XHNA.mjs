import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// ../elt/packages/sdks/apple/launch-services/dist/app-running.js
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
var execFile = promisify(execFileCallback);
async function appRunning(bundle) {
  const { stdout } = await execFile("/usr/bin/lsappinfo", [
    "info",
    "-only",
    "pid",
    "-app",
    bundle
  ]);
  return /\bpid"?\s*=\s*\d+/.test(stdout);
}

export {
  appRunning
};
