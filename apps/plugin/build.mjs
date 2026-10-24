// The installable plugin ships the same server build as the desktop.
import { cpSync, rmSync } from 'node:fs';

const outdir = 'plugins/context-compiler/server';
rmSync(outdir, { recursive: true, force: true });
cpSync('apps/server/dist/server', outdir, { recursive: true });
