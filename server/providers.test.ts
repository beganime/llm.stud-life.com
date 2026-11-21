import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCost, completeProvider, estimateTokens, timewebEndpoint } from './providers.ts';

test('calculateCost respects the selected price unit', () => {
  assert.equal(calculateCost(1000, 500, 2, 4, 1000), 4);
  assert.equal(calculateCost(1000, 500, null, 4, 1000), null);
});

test('estimateTokens returns a marked fallback-sized estimate', () => {
  assert.equal(estimateTokens('12345678'), 2);
  assert.equal(estimateTokens(''), 1);
});

test('OpenAI adapter streams text and usage', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response([
    'data: {"choices":[{"delta":{"content":"Привет"}}]}',
    '',
    'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n'), { status: 200 });
  try {
    const result = await completeProvider({ provider: 'openai', modelId: 'mock', apiKey: 'test' }, [{ role: 'user', content: 'hi' }], new AbortController().signal);
    assert.equal(result.text, 'Привет');
    assert.equal(result.inputTokens, 7);
    assert.equal(result.outputTokens, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('parallel provider failures do not cancel a successful stream', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.model === 'broken') return new Response('{"error":"failed"}', { status: 500, statusText: 'Failed' });
    return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
  };
  try {
    const signal = new AbortController().signal;
    const settled = await Promise.allSettled([
      completeProvider({ provider: 'openai', modelId: 'working', apiKey: 'test' }, [{ role: 'user', content: 'hi' }], signal),
      completeProvider({ provider: 'openai', modelId: 'broken', apiKey: 'test' }, [{ role: 'user', content: 'hi' }], signal),
    ]);
    assert.equal(settled[0].status, 'fulfilled');
    assert.equal(settled[0].status === 'fulfilled' && settled[0].value.text, 'ok');
    assert.equal(settled[1].status, 'rejected');
  } finally { globalThis.fetch = originalFetch; }
});

test('Timeweb endpoint accepts gateway and full agent URLs', () => {
  assert.equal(timewebEndpoint('https://api.timeweb.ai/v1'), 'https://api.timeweb.ai/v1/chat/completions');
  assert.equal(timewebEndpoint('https://agent.timeweb.cloud/api/v1/cloud-ai/agents/demo/v1/chat/completions'), 'https://agent.timeweb.cloud/api/v1/cloud-ai/agents/demo/v1/chat/completions');
  assert.throws(() => timewebEndpoint('http://127.0.0.1:3000/v1'), /Timeweb Cloud/);
  assert.throws(() => timewebEndpoint('https://example.com/v1'), /Timeweb Cloud/);
});

test('Timeweb adapter streams through an OpenAI-compatible custom endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedBody: any;
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url); requestedBody = JSON.parse(String(init?.body));
    return new Response('data: {"choices":[{"delta":{"content":"timeweb"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
  };
  try {
    const result = await completeProvider({ provider: 'timeweb', modelId: 'agent', apiKey: 'test', baseUrl: 'https://agent.timeweb.cloud/api/v1/cloud-ai/agents/demo/v1' }, [{ role: 'user', content: 'hi' }], new AbortController().signal);
    assert.equal(requestedUrl, 'https://agent.timeweb.cloud/api/v1/cloud-ai/agents/demo/v1/chat/completions');
    assert.equal(requestedBody.stream, true);
    assert.equal(requestedBody.stream_options, undefined);
    assert.equal(result.text, 'timeweb');
  } finally { globalThis.fetch = originalFetch; }
});
