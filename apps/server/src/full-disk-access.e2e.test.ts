import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TemporaryFiles } from '@zukhruf/testing/fs';
import { z } from 'zod';

// The workspace root: the test starts the plugin's built server from any
// working directory.
const workspace = resolve(import.meta.dirname, '../../..');

test('the Full Disk Access button receives the structured acknowledgement the page expects', async () => {
  await using scratch = await new TemporaryFiles().directory(
    'page-full-disk-access-',
  );
  const client = new Client({
    name: 'full-disk-access-test',
    version: '1.0.0',
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(workspace, 'plugins/context-compiler/server/main.mjs')],
    env: {
      HOME: scratch.path,
      CONTEXT_COMPILER_GRANTEE: 'Context Compiler',
    },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    // Exercise the real page tool, including opening System Settings. It does
    // not grant permissions; a successful action must still parse in the page.
    const result = await client.callTool({
      name: 'open_full_disk_access',
      arguments: {},
    });
    assert.notEqual(result.isError, true);
    assert.deepEqual(z.object({}).parse(result.structuredContent), {});
    const { tools } = await client.listTools();
    assert.equal(
      tools.find(({ name }) => name === 'open_full_disk_access')?.outputSchema
        ?.type,
      'object',
    );
  } finally {
    await client.close();
    await transport.close();
  }
});
