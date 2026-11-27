export type Provider = 'openai' | 'anthropic' | 'gemini' | 'timeweb' | 'custom';
export type Message = { role: 'user' | 'assistant'; content: string };
export type ProviderConfig = { provider: Provider; modelId: string; apiKey: string; baseUrl?: string | null };
export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number };

async function* sse(response: Response) {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  if (!response.body) throw new Error('Провайдер не вернул поток');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
    if (done) break;
  }
}

function headers(apiKey: string, extra: Record<string, string> = {}) {
  return { 'content-type': 'application/json', ...extra, authorization: `Bearer ${apiKey}` };
}

export async function* streamProvider(cfg: ProviderConfig, messages: Message[], signal: AbortSignal): AsyncGenerator<ProviderEvent> {
  if (cfg.provider === 'openai' || cfg.provider === 'timeweb' || cfg.provider === 'custom') {
    const url = cfg.provider === 'openai' ? 'https://api.openai.com/v1/chat/completions'
      : cfg.provider === 'timeweb' ? timewebEndpoint(cfg.baseUrl || '')
      : customEndpoint(cfg.baseUrl || '');
    const body: Record<string, unknown> = { model: cfg.modelId, messages, stream: true };
    if (cfg.provider === 'openai') body.stream_options = { include_usage: true };
    const response = await fetch(url, {
      method: 'POST', signal, headers: headers(cfg.apiKey),
      body: JSON.stringify(body),
    });
    for await (const data of sse(response)) {
      const text = data.choices?.[0]?.delta?.content;
      if (text) yield { type: 'text', text };
      if (data.usage) yield { type: 'usage', inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens };
    }
    return;
  }

  if (cfg.provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.modelId, messages, max_tokens: 4096, stream: true }),
    });
    for await (const data of sse(response)) {
      if (data.type === 'content_block_delta' && data.delta?.text) yield { type: 'text', text: data.delta.text };
      if (data.type === 'message_start') yield { type: 'usage', inputTokens: data.message?.usage?.input_tokens };
      if (data.type === 'message_delta') yield { type: 'usage', outputTokens: data.usage?.output_tokens };
    }
    return;
  }

  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents }),
  });
  for await (const data of sse(response)) {
    const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('');
    if (text) yield { type: 'text', text };
    if (data.usageMetadata) yield { type: 'usage', inputTokens: data.usageMetadata.promptTokenCount, outputTokens: data.usageMetadata.candidatesTokenCount };
  }
}

export function timewebEndpoint(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Некорректный URL Timeweb Cloud'); }
  const hostname = url.hostname.toLowerCase();
  const allowed = hostname === 'api.timeweb.ai' || hostname === 'agent.timeweb.cloud' || hostname.endsWith('.timeweb.ai') || hostname.endsWith('.timeweb.cloud');
  if (url.protocol !== 'https:' || !allowed || url.username || url.password) throw new Error('Разрешены только HTTPS endpoint на доменах Timeweb Cloud');
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/chat/completions')) url.pathname = `${path}/chat/completions`;
  return url.toString();
}

// OpenAI-совместимый endpoint на своём сервере: разрешены http(s), запрещены
// адреса loopback и приватных сетей, чтобы запросы не уходили внутрь инфраструктуры.
export function customEndpoint(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Некорректный URL своего сервера'); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Разрешены только HTTP(S) endpoint');
  if (url.username || url.password) throw new Error('URL не должен содержать логин и пароль');
  const blocked = hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')
    || /^127\./.test(hostname) || /^0\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)
    || /^169\.254\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || /^\[?::1\]?$/.test(hostname) || /^\[?f[cd][0-9a-f]{2}/.test(hostname);
  if (blocked) throw new Error('Endpoint не должен указывать на локальные и приватные адреса');
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/chat/completions')) url.pathname = `${path}/chat/completions`;
  return url.toString();
}

export async function completeProvider(cfg: ProviderConfig, messages: Message[], signal: AbortSignal) {
  let text = '';
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  for await (const event of streamProvider(cfg, messages, signal)) {
    if (event.type === 'text') text += event.text;
    else usage = { ...usage, ...event };
  }
  return { text, ...usage };
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function calculateCost(inputTokens: number | undefined, outputTokens: number | undefined, inputPrice: number | null, outputPrice: number | null, unit = 1_000_000) {
  if (inputTokens == null || outputTokens == null || inputPrice == null || outputPrice == null) return null;
  return (inputTokens * inputPrice + outputTokens * outputPrice) / unit;
}
