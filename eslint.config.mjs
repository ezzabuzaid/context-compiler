import nx from '@nx/eslint-plugin';
import zukhruf from '@zukhruf/eslint';
import modernNode from '@zukhruf/eslint/modern-node';
import island, { manifest, moduleBoundaries } from '@zukhruf/eslint/nx';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  nx.configs['flat/base'],
  nx.configs['flat/typescript'],
  nx.configs['flat/javascript'],
  {
    // Flat config never reads .gitignore, so build output is listed here.
    ignores: [
      '**/dist',
      '**/out-tsc',
      // sdk-it generates it from apps/websets/openapi.ts.
      'packages/websets-client/src',
    ],
  },
  {
    plugins: { zukhruf, island, manifest },
    extends: [
      'zukhruf/base',
      'zukhruf/tests',
      'zukhruf/diagnostics',
      'island/recommended',
      'manifest/recommended',
    ],
    // Packages are library code: the host (apps/*) reads its environment and
    // passes values in, and a package reports through the errors it throws
    // and the values it returns, never through console.
    settings: { island: { libraries: ['packages/**/*.{ts,tsx}'] } },
  },
  // Modern Node is for code that runs on Node. apps/startup-credits stays out
  // because the user said: "don't change anything on startupcredit". The glob
  // resolves from the folder of the config that ESLint loads, so it matches
  // nothing under apps/ambient, which spreads this config.
  {
    ignores: ['apps/startup-credits/**'],
    plugins: { 'modern-node': modernNode },
    extends: ['modern-node/recommended'],
  },
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        moduleBoundaries({
          // The Calendar connector imports ./google-calendar-attachments with
          // a dynamic import() so gaxios loads only for an import that uses a
          // Google session, and its source statically from the same package.
          // Nx marks the whole project edge lazy once one dynamic import
          // crosses it (@nx/eslint-plugin runtime-lint-utils hasDynamicImport)
          // and then rejects every static import of it. Matched as an
          // unanchored regex, hence the anchors.
          checkDynamicDependenciesExceptions: [
            '^@eltjs/source-apple-calendar(/.*)?$',
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
