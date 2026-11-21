import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowUp, Bot, Check, CircleStop, Clock3, RefreshCw, Sparkles, Star, ThumbsDown, ThumbsUp, Trophy, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, streamJson } from '../lib/api';
import { getGuestKey, loadGuestChats, saveGuestChats } from '../lib/guest';
import type { AiEvaluation, Chat, Comparison, ModelConfig, ModelResult, User } from '../types';

export function ChatPage({ user, models, onDataChanged }: { user: User | null; models: ModelConfig[]; onDataChanged: () => void }) {
  const { chatId } = useParams(); const navigate = useNavigate();
  const [chat, setChat] = useState<Chat | null>(null); const [loading, setLoading] = useState(Boolean(chatId));
  const [selected, setSelected] = useState<string[]>([]); const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false); const [mobileResult, setMobileResult] = useState(0);
  const [judgeTarget, setJudgeTarget] = useState<Comparison | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const threadEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected((current) => current.filter((id) => models.some((m) => m.id === id)).slice(0, 10));
  }, [models]);
  useEffect(() => {
    let active = true;
    if (!chatId) { setChat(null); setLoading(false); return; }
    setLoading(true);
    const load = user ? api<Chat>(`/chats/${chatId}`) : Promise.resolve(loadGuestChats().find((item) => item.id === chatId) || null);
    load.then((value) => { if (active) setChat(value ? normalizeChat(value) : null); }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [chatId, user]);
  useEffect(() => { threadEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat?.comparisons.length, running]);

  const toggleModel = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 10 ? [...current, id] : current);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim(); const picked = models.filter((model) => selected.includes(model.id));
    if (!text || !picked.length || running) return;
    setPrompt(''); setRunning(true); setMobileResult(0);
    const comparison: Comparison = { id: crypto.randomUUID(), prompt: text, createdAt: new Date().toISOString(), results: picked.map(resultFromModel) };
    const baseChat: Chat = chat || { id: crypto.randomUUID(), title: text.slice(0, 60), createdAt: comparison.createdAt, updatedAt: comparison.createdAt, comparisons: [] };
    setChat({ ...baseChat, comparisons: [...baseChat.comparisons, comparison] });
    const startedOrder = { value: '' }; const finishedOrder = { value: '' };
    const outcomes = await Promise.all(picked.map((model) => generate(model, comparison, baseChat, startedOrder, finishedOrder)));
    const finishedComparison = { ...comparison, results: outcomes };
    const finishedChat = { ...baseChat, updatedAt: new Date().toISOString(), comparisons: [...baseChat.comparisons, finishedComparison] };
    setChat(finishedChat); setRunning(false);
    if (user) {
      try {
        const saved = await api<{ chatId: string; comparisonId: string }>('/comparisons', { method: 'POST', body: JSON.stringify({ chatId: chat?.id, prompt: text, results: outcomes }) });
        onDataChanged(); if (!chatId) navigate(`/chat/${saved.chatId}`, { replace: true });
      } catch (error) { console.error(error); }
    } else {
      const all = loadGuestChats().filter((item) => item.id !== finishedChat.id); saveGuestChats([finishedChat, ...all]); onDataChanged();
      if (!chatId) navigate(`/chat/${finishedChat.id}`, { replace: true });
    }
  };

  const generate = async (model: ModelConfig, comparison: Comparison, baseChat: Chat, startedOrder: { value: string }, finishedOrder: { value: string }): Promise<ModelResult> => {
    const controller = new AbortController(); controllers.current.set(comparison.id + model.id, controller);
    let result = resultFromModel(model); result.status = 'streaming';
    updateResult(comparison.id, model.id, result);
    const history = buildHistory(baseChat, model.id, comparison.prompt);
    const guestKey = user ? undefined : getGuestKey(model.id);
    if (!user && !guestKey) {
      result = { ...result, status: 'error', error: 'Ключ недоступен после перезагрузки. Введите его снова на странице «Модели».' };
      updateResult(comparison.id, model.id, result); return result;
    }
    try {
      await streamJson('/generate', { model: user ? { modelConfigId: model.id } : { ...model, apiKey: guestKey }, messages: history }, controller.signal, (event) => {
        if (event.type === 'text') {
          if (!startedOrder.value) startedOrder.value = model.id;
          result = { ...result, response: result.response + event.text, firstTokenMs: event.firstTokenMs, firstStarted: startedOrder.value === model.id };
        } else if (event.type === 'done') {
          if (!finishedOrder.value) finishedOrder.value = model.id;
          result = { ...result, status: 'done', firstTokenMs: event.firstTokenMs, totalMs: event.totalMs, inputTokens: event.inputTokens, outputTokens: event.outputTokens, tokenEstimated: event.estimated, cost: event.cost, currency: event.currency, firstFinished: finishedOrder.value === model.id };
        } else if (event.type === 'error' || event.type === 'cancelled') result = { ...result, status: event.type, error: event.error, totalMs: event.totalMs };
        updateResult(comparison.id, model.id, result);
      });
    } catch (error) {
      result = { ...result, status: controller.signal.aborted ? 'cancelled' : 'error', error: controller.signal.aborted ? 'Генерация отменена' : error instanceof Error ? error.message : 'Ошибка' };
      updateResult(comparison.id, model.id, result);
    } finally { controllers.current.delete(comparison.id + model.id); }
    return result;
  };

  const updateResult = (comparisonId: string, modelId: string, result: ModelResult) => setChat((current) => current ? ({ ...current, comparisons: current.comparisons.map((c) => c.id === comparisonId ? { ...c, results: c.results.map((r) => r.modelConfigId === modelId ? result : r) } : c) }) : current);

  const stopAll = () => controllers.current.forEach((controller) => controller.abort());
  const retry = async (comparison: Comparison, result: ModelResult) => {
    const model = models.find((item) => item.id === result.modelConfigId); if (!model || running) return;
    setSelected([model.id]); setPrompt(comparison.prompt); requestAnimationFrame(() => document.querySelector<HTMLFormElement>('.composer')?.requestSubmit());
  };

  const rate = async (comparison: Comparison, result: ModelResult, patch: Partial<ModelResult>) => {
    const next = { ...result, ...patch };
    setChat((current) => current ? { ...current, comparisons: current.comparisons.map((c) => c.id === comparison.id ? { ...c, results: c.results.map((r) => {
      if (patch.isWinner) return r.id === result.id ? next : { ...r, isWinner: false };
      return r.id === result.id ? next : r;
    }) } : c) } : null);
    if (user) await api(`/results/${result.id}`, { method: 'PATCH', body: JSON.stringify(patch) }).catch(() => undefined);
    else setTimeout(() => setChat((current) => { if (current) { const all = loadGuestChats().filter((c) => c.id !== current.id); saveGuestChats([current, ...all]); } return current; }), 0);
  };

  if (loading) return <div className="center-screen"><span className="spinner" />Загружаем чат…</div>;
  const hasConversation = Boolean(chat?.comparisons.length);
  return <div className={`chat-page ${hasConversation ? 'has-thread' : ''}`}>
    {!hasConversation && <section className="welcome"><div className="welcome-mark"><Bot size={24} /></div><h1>Сравните ответы моделей</h1><p>Один вопрос — до десяти независимых ответов с метриками скорости, токенов, стоимости и качества.</p></section>}
    {hasConversation && <div className="thread">
      {chat!.comparisons.map((comparison) => <section className="turn" key={comparison.id}>
        <div className="user-message"><div>{comparison.prompt}</div></div>
        {comparison.results.length > 1 && <div className="mobile-tabs">{comparison.results.map((result, index) => <button className={mobileResult === index ? 'active' : ''} onClick={() => setMobileResult(index)} key={result.id}>{result.modelName}</button>)}</div>}
        <div className={`results-grid count-${comparison.results.length}`}>
          {comparison.results.map((result, index) => <ResultCard key={result.id} result={result} hiddenMobile={comparison.results.length > 1 && mobileResult !== index} onStop={() => controllers.current.get(comparison.id + result.modelConfigId)?.abort()} onRetry={() => retry(comparison, result)} onRate={(patch) => rate(comparison, result, patch)} />)}
        </div>
        {comparison.results.length > 1 && comparison.results.every((r) => r.status !== 'streaming' && r.status !== 'idle') && <button className="judge-button" onClick={() => setJudgeTarget(comparison)}><Sparkles size={16} />Оценить ответы с помощью ИИ</button>}
      </section>)}
      <div ref={threadEnd} />
    </div>}
    <div className="composer-dock">
      <div className="model-picker">
        <span className="picker-label">Модели</span>
        <div className="model-chips">{models.map((model) => <button type="button" key={model.id} className={selected.includes(model.id) ? 'selected' : ''} onClick={() => toggleModel(model.id)}><span>{model.displayName}</span>{selected.includes(model.id) && <Check size={13} />}</button>)}</div>
        {!models.length && <button className="text-button" onClick={() => navigate('/models')}>Подключить модель</button>}
      </div>
      <form className="composer" onSubmit={submit}>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder={models.length ? 'Задайте один вопрос всем выбранным моделям' : 'Сначала подключите модель'} rows={1} disabled={!models.length} />
        {running ? <button type="button" className="send-button" onClick={stopAll} aria-label="Остановить"><CircleStop size={18} /></button> : <button className="send-button" disabled={!prompt.trim() || !selected.length} aria-label="Отправить"><ArrowUp size={19} strokeWidth={2.4} /></button>}
      </form>
      <small className="composer-hint">Enter — отправить · Shift + Enter — новая строка · выбрано {selected.length}/10</small>
    </div>
    {judgeTarget && <JudgeModal comparison={judgeTarget} models={models} user={user} onClose={() => setJudgeTarget(null)} onSaved={(evaluations) => {
      evaluations.forEach(({ resultId, evaluation }) => { const result = judgeTarget.results.find((r) => r.id === resultId); if (result) rate(judgeTarget, result, { aiEvaluation: evaluation }); }); setJudgeTarget(null);
    }} />}
  </div>;
}

function resultFromModel(model: ModelConfig): ModelResult {
  return { id: crypto.randomUUID(), modelConfigId: model.id, modelName: model.displayName, provider: model.provider, modelId: model.modelId, inputPrice: model.inputPrice, outputPrice: model.outputPrice, priceUnit: model.priceUnit, currency: model.currency, response: '', status: 'idle' };
}

function buildHistory(chat: Chat, modelConfigId: string, prompt: string) {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const comparison of chat.comparisons) {
    messages.push({ role: 'user', content: comparison.prompt });
    const prior = comparison.results.find((r) => r.modelConfigId === modelConfigId);
    if (prior?.response) messages.push({ role: 'assistant', content: prior.response });
  }
  messages.push({ role: 'user', content: prompt }); return messages;
}

function normalizeChat(chat: Chat): Chat {
  return { ...chat, comparisons: chat.comparisons.map((c) => ({ ...c, results: c.results.map((r: any) => ({ ...r, tokenEstimated: Boolean(r.tokenEstimated), isWinner: Boolean(r.isWinner), liked: r.liked == null ? null : Boolean(r.liked), aiEvaluation: typeof r.aiEvaluation === 'string' ? JSON.parse(r.aiEvaluation) : r.aiEvaluation })) })) };
}

function ResultCard({ result, hiddenMobile, onStop, onRetry, onRate }: { result: ModelResult; hiddenMobile: boolean; onStop: () => void; onRetry: () => void; onRate: (patch: Partial<ModelResult>) => void }) {
  const tokens = result.inputTokens != null ? `${result.inputTokens} / ${result.outputTokens} / ${(result.inputTokens || 0) + (result.outputTokens || 0)}${result.tokenEstimated ? ' ≈' : ''}` : 'Нет данных';
  return <article className={`result-card ${hiddenMobile ? 'mobile-hidden' : ''}`}>
    <header><div><span className="provider-dot">{result.provider[0].toUpperCase()}</span><div><strong>{result.modelName}</strong><small>{result.modelId}</small></div></div>
      {result.status === 'streaming' ? <button className="icon-button" onClick={onStop} title="Отменить"><CircleStop size={17} /></button> : <button className="icon-button" onClick={onRetry} title="Повторить"><RefreshCw size={16} /></button>}
    </header>
    {(result.firstStarted || result.firstFinished) && <div className="result-badges">{result.firstStarted && <span><Clock3 size={12} />Первым начал</span>}{result.firstFinished && <span><Trophy size={12} />Первым завершил</span>}</div>}
    <div className="answer-body">
      {result.response ? <div className="markdown-answer"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" /> }}>{result.response}</ReactMarkdown></div> : result.status === 'streaming' ? <div className="thinking"><span /><span /><span />Ожидаем ответ</div> : null}
      {result.status === 'error' && <div className="inline-error">{result.error}</div>}
      {result.status === 'cancelled' && <div className="muted">Генерация отменена</div>}
    </div>
    {result.status !== 'streaming' && result.status !== 'idle' && <>
      <div className="metrics">
        <Metric label="До ответа" value={result.firstTokenMs != null ? formatMs(result.firstTokenMs) : 'Нет данных'} />
        <Metric label="Полное время" value={result.totalMs != null ? formatMs(result.totalMs) : 'Нет данных'} />
        <Metric label="Токены вх. / исх. / всего" value={tokens} />
        <Metric label="Стоимость" value={result.cost != null ? `${result.cost.toFixed(6)} ${result.currency}` : 'Нет данных'} />
      </div>
      <div className="quality-row"><span>Качество</span><div>
        <button className={result.liked === true ? 'active' : ''} onClick={() => onRate({ liked: true })} title="Ответ подошёл"><ThumbsUp size={15} /></button>
        <button className={result.liked === false ? 'active' : ''} onClick={() => onRate({ liked: false })} title="Ответ не подошёл"><ThumbsDown size={15} /></button>
        {[1,2,3,4,5].map((value) => <button key={value} className={result.rating && value <= result.rating ? 'active' : ''} onClick={() => onRate({ rating: value })}><Star size={14} fill={result.rating && value <= result.rating ? 'currentColor' : 'none'} /></button>)}
      </div></div>
      <button className={`winner-button ${result.isWinner ? 'active' : ''}`} onClick={() => onRate({ isWinner: true })}><Trophy size={14} />{result.isWinner ? 'Лучший ответ' : 'Выбрать лучшим'}</button>
      {result.aiEvaluation && <div className="ai-score"><div><Sparkles size={15} /><strong>Оценка ИИ · {result.aiEvaluation.evaluator}</strong></div><p>{result.aiEvaluation.explanation}</p><small>Релевантность {result.aiEvaluation.relevance}/5 · Полнота {result.aiEvaluation.completeness}/5 · Ясность {result.aiEvaluation.clarity}/5 · Обоснованность {result.aiEvaluation.reasoning}/5</small></div>}
    </>}
  </article>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function formatMs(value: number) { return value < 1000 ? `${value} мс` : `${(value / 1000).toFixed(2)} с`; }

function JudgeModal({ comparison, models, user, onClose, onSaved }: { comparison: Comparison; models: ModelConfig[]; user: User | null; onClose: () => void; onSaved: (values: { resultId: string; evaluation: AiEvaluation }[]) => void }) {
  const [modelId, setModelId] = useState(models[0]?.id || ''); const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const evaluate = async () => {
    const model = models.find((item) => item.id === modelId); if (!model || !consent) return; setBusy(true); setError('');
    try {
      const key = user ? undefined : getGuestKey(model.id);
      const result = await api<{ evaluator: string; evaluations: any[] }>('/judge', { method: 'POST', body: JSON.stringify({ consent, model: user ? { modelConfigId: model.id } : { ...model, apiKey: key }, question: comparison.prompt, answers: comparison.results.map((r) => r.response) }) });
      onSaved(result.evaluations.map((value, index) => ({ resultId: comparison.results[index].id, evaluation: { evaluator: result.evaluator, relevance: value.relevance, completeness: value.completeness, clarity: value.clarity, reasoning: value.reasoning, explanation: value.explanation } })));
    } catch (err) { setError(err instanceof Error ? err.message : 'Ошибка оценки'); } finally { setBusy(false); }
  };
  return <div className="modal-scrim"><div className="modal judge-modal"><button className="icon-button modal-close" onClick={onClose}><X size={19} /></button><Sparkles size={21} /><h2>Оценить ответы с помощью ИИ</h2><p className="muted">Вопрос и обезличенные ответы будут отправлены выбранному провайдеру. Запрос может тарифицироваться.</p>
    <label>Модель-оценщик<select value={modelId} onChange={(e) => setModelId(e.target.value)}>{models.map((m) => <option value={m.id} key={m.id}>{m.displayName}</option>)}</select></label>
    <label className="check-label"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />Я понимаю, какие данные будут отправлены</label>
    {error && <div className="form-error">{error}</div>}<div className="modal-actions"><button className="button" onClick={onClose}>Отмена</button><button className="button dark" disabled={!consent || busy} onClick={evaluate}>{busy ? 'Оцениваем…' : 'Запустить оценку'}</button></div>
  </div></div>;
}
