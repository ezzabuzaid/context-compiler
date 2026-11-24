import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  APICallError,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  Output,
  generateText,
} from 'ai';
import { z } from 'zod';

import { CallFailures } from './call-failures.ts';

// A chat completions API on a local port, which gives each request the
// status and the body that respond() returns for it. The AI SDK talks to it
// over HTTP as it talks to a real provider.
async function api(
  respond: (request: number) => { status: number; body: unknown },
) {
  let requests = 0;
  const server = createServer((request, response) => {
    request.resume();
    const { status, body } = respond(++requests);
    // retry-after-ms makes the AI SDK retry at once, not after seconds.
    response.writeHead(status, {
      'content-type': 'application/json',
      'retry-after-ms': '1',
    });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const { port } = address;
  const model = createOpenAICompatible({
    name: 'api',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'key',
  }).chatModel('model');
  return { model, requests: () => requests, server };
}

const ask = (model: Parameters<typeof generateText>[0]['model']) =>
  generateText({
    model,
    prompt: 'List the offers.',
    output: Output.object({
      schema: z.object({ offers: z.array(z.string()) }),
    }),
  }).then((generated) => generated.output);

// The error that the call throws.
const failed = (model: Parameters<typeof generateText>[0]['model']) =>
  ask(model).then(
    () => assert.fail('the call answered'),
    (error: unknown) => error,
  );

test('a call that fails after the retries with a 500 is the failure of its item, for the reason of the last call', async () => {
  const { model, requests, server } = await api((request) => ({
    status: 500,
    body: { error: { message: `The server is busy (${request}).` } },
  }));
  try {
    const error = await failed(model);

    const reason = new CallFailures().reason(error);

    assert.equal(requests(), 3);
    assert.equal(reason, 'The server is busy (3).');
  } finally {
    server.close();
  }
});

test('a call that the API rejects with a 401 throws, so the run fails', async () => {
  const { model, server } = await api(() => ({
    status: 401,
    body: { error: { message: 'No auth credentials found' } },
  }));
  try {
    const error = await failed(model);

    const reason = () => new CallFailures().reason(error);

    assert.throws(
      reason,
      (thrown) =>
        thrown === error &&
        APICallError.isInstance(thrown) &&
        thrown.statusCode === 401,
    );
  } finally {
    server.close();
  }
});

test('a 401 and a missing key are credential errors, and a call that fails after the retries with a 500 is not', async () => {
  const { model: rejecting, server: rejects } = await api(() => ({
    status: 401,
    body: { error: { message: 'No auth credentials found' } },
  }));
  const { model: busy, server: busies } = await api(() => ({
    status: 500,
    body: { error: { message: 'The server is busy.' } },
  }));
  try {
    const rejected = await failed(rejecting);
    const failedAfterRetries = await failed(busy);
    // What a provider's loadApiKey throws when neither its option nor its
    // environment variable holds a key.
    const missing = new LoadAPIKeyError({ message: 'API key is missing.' });

    assert.equal(CallFailures.isCredentialError(rejected), true);
    assert.equal(CallFailures.isCredentialError(missing), true);
    assert.equal(CallFailures.isCredentialError(failedAfterRetries), false);
  } finally {
    rejects.close();
    busies.close();
  }
});

test('an answer error that the caller names is the failure of its item, and one that it does not name throws', async () => {
  const { model, server } = await api(() => ({
    status: 200,
    body: {
      id: 'answer',
      object: 'chat.completion',
      created: 0,
      model: 'model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'I cannot list them.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  }));
  try {
    const error = await failed(model);

    const named = new CallFailures(NoObjectGeneratedError).reason(error);
    const unnamed = () => new CallFailures().reason(error);

    assert.ok(NoObjectGeneratedError.isInstance(error));
    assert.equal(named, error.message);
    assert.throws(unnamed, (thrown) => thrown === error);
  } finally {
    server.close();
  }
});
