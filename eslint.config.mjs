import nx from '@nx/eslint-plugin';

import personalConfig from './personal.eslint.config.mjs';

const testHookRestrictedSyntax = [
  {
    selector:
      'CallExpression[callee.name=/^(before|after|beforeEach|afterEach|beforeAll|afterAll)$/]',
    message:
      'No test lifecycle hooks. Write self-contained AAA tests: inline arrange in each test and run teardown (cleanup, mock restore, resource stop) in a per-test try/finally.',
  },
];

const enumRestrictedSyntax = [
  {
    selector: 'TSEnumDeclaration',
    message:
      'No TS enums — they need a runtime transform and break Node strip-only `.ts` execution (tsc/bundlers hide it). Use a `const` object + a union type instead.',
  },
];

// msw only answers what a handler lists; without this option an unstubbed
// request is warned about and sent to the real network, so the test passes on
// a live dependency it never meant to touch. Scoped by the msw/node import.
const mswUnhandledRequestSyntax = [
  {
    selector:
      'Program:has(ImportDeclaration[source.value="msw/node"]) CallExpression[callee.property.name="listen"]:matches([arguments.length=0], [arguments.0.type="ObjectExpression"]):not(:has(Property[key.name="onUnhandledRequest"] > Literal[value="error"]))',
    message:
      "msw: server.listen() must pass { onUnhandledRequest: 'error' } so an unstubbed request fails the test instead of reaching the network.",
  },
];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    // Flat config never reads .gitignore, so build output and the bundled
    // plugin server are listed here.
    ignores: ['**/dist', '**/out-tsc', 'plugins/context-compiler/server'],
  },
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?js$'],
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
          depConstraints: [{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      'no-unused-private-class-members': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/parameter-properties': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.cts', '**/*.mts'],
    ignores: ['**/*.test.ts', '**/*.test.cts', '**/*.test.mts'],
    rules: {
      'no-restricted-syntax': ['error', ...enumRestrictedSyntax],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.cts', '**/*.test.mts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...testHookRestrictedSyntax,
        ...mswUnhandledRequestSyntax,
        ...enumRestrictedSyntax,
      ],
    },
  },
  {
    // Packages are library code: the host (apps/*) reads its environment and
    // passes values in, and a package reports through the errors it throws and
    // the values it returns, never through console.
    files: ['packages/**/*.{ts,tsx,mts,cts}'],
    // A script's stdout is its interface, and a config file runs at build time
    // on the developer's environment.
    ignores: [
      '**/*.test.{ts,tsx,mts,cts}',
      '**/scripts/**',
      '**/*.config.{js,cjs,mjs,ts,mts,cts}',
    ],
    rules: {
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Library code must not read process.env. Take the value as an option the library types; the host reads its environment.',
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.cts', '**/*.mts'],
    // A disable directive that no longer suppresses anything is an escape hatch
    // that outlived its reason.
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  ...personalConfig,
];
