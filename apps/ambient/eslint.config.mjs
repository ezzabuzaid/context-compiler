import base from '../../eslint.config.mjs';

// Each Zukhruf part has one file, as in Zukhruf's own layout.
const homes = [
  ['defineAgent', 'src/agent.ts'],
  ['defineInstructions', 'src/instructions.ts'],
  ['defineSandbox', 'src/sandbox.ts'],
  ['defineStack', 'src/stack.ts'],
  ['AgentRuntime', 'src/run.ts'],
  ['defineTool', 'src/plugins/*/tools/*.ts'],
];
const restriction = ([name, file]) => ({
  selector: `ImportDeclaration[source.value="@deepagents/experimental/zukhruf"] > ImportSpecifier[imported.name="${name}"]`,
  message: `Ambient uses ${name} only in ${file}.`,
});

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@deepagents/context',
              importNames: [
                'agent',
                'structuredOutput',
                'ContextEngine',
                'InMemoryContextStore',
                'createVirtualSandbox',
                'createHostSandbox',
                'createDockerSandbox',
              ],
              message:
                'Ambient uses Zukhruf for execution and context, and Microsandbox for isolation.',
            },
          ],
          patterns: [
            {
              group: [
                '@deepagents/agent',
                '@deepagents/agent/*',
                '@zukhruf/mutex',
                '@zukhruf/mutex/*',
              ],
              message:
                'Ambient delegates execution and serialization to the Zukhruf runtime.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: homes.map(([, file]) => file),
    rules: {
      'no-restricted-syntax': ['error', ...homes.map(restriction)],
    },
  },
  ...homes.map((home) => ({
    files: [home[1]],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...homes.filter((other) => other !== home).map(restriction),
      ],
    },
  })),
];
