import { useEffect, useState, type FormEvent } from 'react';
import { Check, KeyRound, Plus, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { deleteGuestKey, getGuestKey, saveGuestModels, setGuestKey } from '../lib/guest';
import type { ModelConfig, Provider, User } from '../types';

const emptyModel = (): ModelConfig => ({ id: crypto.randomUUID(), displayName: '', provider: 'openai', modelId: '', baseUrl: null, apiKey: '', inputPrice: null, outputPrice: null, priceUnit: 1000000, currency: 'USD' });
const providerNames: Record<Provider, string> = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', timeweb: 'Timeweb Cloud', custom: 'Свой сервер' };
const modelHints: Record<Provider, string> = { openai: 'gpt-4.1-mini', anthropic: 'claude-sonnet-4-5', gemini: 'gemini-2.5-flash', timeweb: 'openai/gpt-4.1-mini или agent', custom: 'например, llama3.1:8b или qwen2.5-7b' };

export function ModelsPage({ user, models, onChanged }: { user: User | null; models: ModelConfig[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setEditing(null); }, [user?.id]);

  const startEdit = (model: ModelConfig) => setEditing({ ...model, apiKey: user ? '' : getGuestKey(model.id) || '' });
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editing) return; setBusy(true); setError(''); setNotice('');
    try {
      if (user) {
        const existing = models.some((item) => item.id === editing.id);
        await api(`/models${existing ? `/${editing.id}` : ''}`, { method: existing ? 'PUT' : 'POST', body: JSON.stringify(editing) });
      } else {
        const next = [...models.filter((item) => item.id !== editing.id), { ...editing, apiKey: undefined }];
        saveGuestModels(next); setGuestKey(editing.id, editing.apiKey || '');
      }
      setEditing(null); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Ошибка сохранения'); }
    finally { setBusy(false); }
  };

  const test = async () => {
    if (!editing) return; setBusy(true); setError(''); setNotice('');
    try {
      const isSaved = user && models.some((item) => item.id === editing.id) && !editing.apiKey;
      const result = await api<{ ok: boolean; reply: string }>('/models/test', { method: 'POST', body: JSON.stringify(isSaved ? { modelConfigId: editing.id } : editing) });
      setNotice(`Подключение работает${result.reply ? ` · ${result.reply}` : ''}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Ошибка подключения'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!editing || !confirm(`Удалить «${editing.displayName}»? Старые результаты останутся в истории.`)) return;
    if (user) await api(`/models/${editing.id}`, { method: 'DELETE' });
    else { saveGuestModels(models.filter((item) => item.id !== editing.id)); deleteGuestKey(editing.id); }
    setEditing(null); onChanged();
  };

  return <div className="page page-wide">
    <header className="page-header"><div><h1>Модели</h1><p>Подключите до 10 моделей. Ключи аккаунта шифруются на сервере.</p></div>
      <button className="button" disabled={models.length >= 10} onClick={() => setEditing(emptyModel())}><Plus size={17} />Добавить модель</button>
    </header>
    {!user && <div className="notice"><KeyRound size={17} /><div><strong>Гостевой режим</strong><p>Ключи живут только в памяти этой вкладки. После перезагрузки их нужно ввести снова.</p></div></div>}
    <div className="model-grid">
      {models.map((model) => <button className="model-card" key={model.id} onClick={() => startEdit(model)}>
        <span className="provider-glyph">{providerNames[model.provider][0]}</span>
        <span><strong>{model.displayName}</strong><small>{providerNames[model.provider]} · {model.modelId}</small></span>
        <span className="connection-state">{user || getGuestKey(model.id) ? <><Check size={14} /> Готова</> : 'Нужен ключ'}</span>
      </button>)}
      {!models.length && <div className="empty-panel"><div className="empty-icon"><KeyRound size={22} /></div><h2>Подключите первую модель</h2><p>Добавьте ключ OpenAI, Anthropic или Gemini, чтобы начать сравнение.</p><button className="button dark" onClick={() => setEditing(emptyModel())}><Plus size={17} />Добавить модель</button></div>}
    </div>
    {editing && <div className="modal-scrim" role="dialog" aria-modal="true"><div className="modal model-modal">
      <button className="icon-button modal-close" onClick={() => setEditing(null)}><X size={19} /></button>
      <h2>{models.some((m) => m.id === editing.id) ? 'Настройка модели' : 'Новая модель'}</h2>
      <p className="muted">Запросы к провайдеру выполняются только через сервер.</p>
      <form onSubmit={save} className="stack-form two-column-form">
        <label className="full">Название для отображения<input required value={editing.displayName} placeholder="Моя модель для перевода" onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} /></label>
        <label>Провайдер<select value={editing.provider} onChange={(e) => setEditing({ ...editing, provider: e.target.value as Provider, modelId: e.target.value === 'timeweb' && !editing.modelId ? 'agent' : editing.modelId })}>{Object.entries(providerNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Идентификатор модели<input required value={editing.modelId} placeholder={modelHints[editing.provider]} onChange={(e) => setEditing({ ...editing, modelId: e.target.value })} /></label>
        {editing.provider === 'timeweb' && <label className="full">Base URL или полная ссылка Timeweb<input required type="url" value={editing.baseUrl || ''} placeholder="https://api.timeweb.ai/v1 или https://agent.timeweb.cloud/.../v1/chat/completions" onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} /><small>Для AI Gateway вставьте Base URL из панели. Для AI-агента можно вставить полную специальную ссылку; `/chat/completions` добавится автоматически, если его нет.</small></label>}
        {editing.provider === 'custom' && <label className="full">URL своего сервера (OpenAI-совместимый API)<input required type="url" value={editing.baseUrl || ''} placeholder="https://my-server.example/v1" onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} /><small>Подойдёт Ollama, vLLM, LM Studio, text-generation-webui и любой OpenAI-совместимый сервер. `/chat/completions` добавится автоматически, если его нет.</small></label>}
        <label className="full">API-ключ<input type="password" required={!user || !models.some((m) => m.id === editing.id)} value={editing.apiKey || ''} placeholder={editing.maskedKey || 'sk-…'} autoComplete="off" onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} /><small>{user && editing.maskedKey ? 'Оставьте пустым, чтобы сохранить текущий ключ.' : 'Ключ не попадёт в историю и журналы.'}</small></label>
        <label>Цена входных токенов<input type="number" min="0" step="any" value={editing.inputPrice ?? ''} placeholder="Необязательно" onChange={(e) => setEditing({ ...editing, inputPrice: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <label>Цена выходных токенов<input type="number" min="0" step="any" value={editing.outputPrice ?? ''} placeholder="Необязательно" onChange={(e) => setEditing({ ...editing, outputPrice: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <label>Цена указана за<select value={editing.priceUnit} onChange={(e) => setEditing({ ...editing, priceUnit: Number(e.target.value) as 1 | 1000 | 1000000 })}><option value={1}>1 токен</option><option value={1000}>1 000 токенов</option><option value={1000000}>1 000 000 токенов</option></select></label>
        <label>Валюта<select value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })}><option>USD</option><option>EUR</option><option>RUB</option></select></label>
        {error && <div className="form-error full">{error}</div>}{notice && <div className="form-success full">{notice}</div>}
        <div className="form-actions full">
          {models.some((m) => m.id === editing.id) && <button type="button" className="button danger" onClick={remove}><Trash2 size={16} />Удалить</button>}
          <span />
          <button type="button" className="button" disabled={busy} onClick={test}>Проверить подключение</button>
          <button className="button dark" disabled={busy}>{busy ? 'Подождите…' : 'Сохранить'}</button>
        </div>
      </form>
    </div></div>}
  </div>;
}
