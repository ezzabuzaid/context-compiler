import nx from '@nx/eslint-plugin';
import zukhruf from '@zukhruf/eslint';
import island, { manifest, moduleBoundaries } from '@zukhruf/eslint/nx';
import react from '@zukhruf/eslint/react';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  nx.configs['flat/base'],
  nx.configs['flat/typescript'],
  nx.configs['flat/javascript'],
  {
    // Flat config never reads .gitignore, so build output and the bundled
    // plugin server are listed here.
    ignores: [
      '**/dist',
      '**/out-tsc',
      'plugins/context-compiler/server',
      // sdk-it generates it from apps/websets/openapi.ts.
      'packages/websets-client/src',
    ],
  },
  // The React preset comes before the zukhruf configs, so base's changes to
  // third-party rules win.
  {
    files: [
      'packages/ui/**',
      'apps/desktop/frontend/**',
      'apps/server/src/page/**',
    ],
    extends: [react],
  },
  {
    plugins: { zukhruf, island, manifest },
    extends: [
      'zukhruf/base',
      'zukhruf/tests',
      'zukhruf/diagnostics',
      'zukhruf/react',
      'island/recommended',
      'manifest/recommended',
    ],
    // Packages are library code: the host (apps/*) reads its environment and
    // passes values in, and a package reports through the errors it throws
    // and the values it returns, never through console.
    settings: { island: { libraries: ['packages/**/*.{ts,tsx}'] } },
    rules: {
      'manifest/dependency-checks': [
        'error',
        {
          // The desktop's Vite config builds its frontend; it never ships.
          ignoredFiles: ['{projectRoot}/frontend/vite.config.mts'],
          // Electron runs the desktop app; the app does not ship it.
          projects: { 'apps/desktop': { ignoredDependencies: ['electron'] } },
        },
      ],
    },
  },
  // The React components of packages/ui wait on the timers of the browser. How
  // a component gets a clock is not decided yet (zukhruf #3600), so
  // island/no-ambient-time does not reach them, as in zukhruf's ui and shadcn.
  {
    files: ['packages/ui/src/**'],
    rules: { 'island/no-ambient-time': 'off' },
  },
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        moduleBoundaries({
          // The Calendar connector imports ./google-calendar-attachments with
          // a dynamic import() so gaxios stays out of the plugin's startup
          // code, and its source statically from the same package. Nx marks
          // the whole project edge lazy once one dynamic import crosses it
          // (@nx/eslint-plugin runtime-lint-utils hasDynamicImport) and then
          // rejects every static import of it; that guards per-project code
          // splitting, while the plugin bundle splits per module. Matched as
          // an unanchored regex, hence the anchors.
          checkDynamicDependenciesExceptions: [
            '^@workspace/source-apple-calendar(/.*)?$',
          ],
        }),
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx,cts,mts,js,jsx,cjs,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@deepagents/agent', '@deepagents/agent/*'],
              message:
                '@deepagents/agent is legacy. Build with @deepagents/context + the AI SDK directly.',
            },
          ],
        },
      ],
    },
  },
  {
    // The pre-commit hook script, which no tsconfig includes; typed lint gives
    // it the default project instead of a parse error.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['.husky/*.ts'] },
      },
    },
  },
);
