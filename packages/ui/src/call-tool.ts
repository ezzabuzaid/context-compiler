import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { z } from 'zod';

import type { PageClient } from './client.ts';

// Calls one of the server's page tools through its host and parses its result
// with the shape the page expects. A tool error becomes a thrown Error with
// the tool's own message, which the page shows as it is. A call gives up after
// the SDK's 60 seconds unless its options allow longer.
export async function callTool<Shape extends z.ZodRawShape>(
  app: PageClient,
  name: string,
  args: Record<string, unknown>,
  shape: Shape,
  options?: RequestOptions,
): Promise<z.infer<z.ZodObject<Shape>>> {
  const result = await app.callServerTool({ name, arguments: args }, options);
  if (result.isError === true)
    throw new Error(
      result.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join(' '),
    );
  return z.object(shape).parse(result.structuredContent);
}

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
