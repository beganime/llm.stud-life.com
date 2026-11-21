export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || 'Ошибка запроса');
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function streamJson(
  url: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: any) => void,
) {
  const response = await fetch(`/api${url}`, {
    method: 'POST', credentials: 'include', signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Ошибка ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Браузер не поддерживает потоковые ответы');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const line = block.split('\n').find((item) => item.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
    if (done) break;
  }
}
