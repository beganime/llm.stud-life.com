import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Check, ChevronDown, ChevronUp, CircleStop, Clock3, Columns3, Copy, Info, Link2, LogIn, LogOut, Menu, MessageSquarePlus, PanelLeft, Plus, RefreshCw, Search, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, streamJson } from '../lib/api';
import { getGuestKey, loadGuestChats, loadGuestModels, saveGuestChats, saveGuestModels, setGuestKey } from '../lib/guest';
import { AuthModal } from '../components/AuthModal';
import type { Chat, ChatSummary, ModelConfig, ModelResult, Provider, User } from '../types';
import './xpage.css';

const MIN_MODELS = 2;
const MAX_MODELS = 4;
const SELECTED_KEY = 'llmc_x_models_v1';
const PROVIDER_NAMES: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google', timeweb: 'Timeweb', custom: 'Свой сервер' };
const MODEL_ID_HINTS: Record<string, string> = {
  openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5', gemini: 'gemini-2.5-flash',
  timeweb: 'openai/gpt-4.1-mini или agent', custom: 'как называется модель на твоём сервере, напр. llama3.1:8b',
};
const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', RUB: '₽', GBP: '£' };

type Turn = { id: string; prompt: string; results: ModelResult[] };
type Badges = { fastest: string | null; cheapest: string | null };
type DemoModel = { id: string; displayName: string; providerLabel: string; modelId: string };
const isDemoModel = (id: string) => id.startsWith('demo:');

function resultFromModel(model: ModelConfig): ModelResult {
  return { id: crypto.randomUUID(), modelConfigId: model.id, modelName: model.displayName, provider: model.provider, modelId: model.modelId, inputPrice: model.inputPrice, outputPrice: model.outputPrice, priceUnit: model.priceUnit, currency: model.currency, response: '', status: 'idle' };
}

function providerName(model: ModelConfig): string {
  return PROVIDER_NAMES[model.provider] || model.provider;
}

function buildHistory(turns: Turn[], modelConfigId: string, prompt: string) {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const turn of turns) {
    messages.push({ role: 'user', content: turn.prompt });
    const prior = turn.results.find((r) => r.modelConfigId === modelConfigId);
    if (prior?.response) messages.push({ role: 'assistant', content: prior.response });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

function normalizeChat(chat: Chat): Chat {
  return {
    ...chat,
    comparisons: chat.comparisons.map((c) => ({
      ...c,
      results: c.results.map((r) => ({ ...r, status: ['done', 'error', 'cancelled'].includes(r.status) ? r.status : 'done' })),
    })),
  };
}

function secondsWord(value: number): string {
  const mod10 = value % 10; const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'секунду';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'секунды';
  return 'секунд';
}

function thinkingLabel(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} ${secondsWord(seconds)}`;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
}

function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] || `${currency} `;
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export function XPage({ user, models, chats, onRefresh }: { user: User | null; models: ModelConfig[]; chats: ChatSummary[]; onRefresh: (knownUser?: User | null) => Promise<void> | void }) {
  const isMobile = useIsMobile();
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(SELECTED_KEY) || '[]'); } catch { return []; }
  });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(() => new URLSearchParams(window.location.search).get('view') === '1');
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState({ displayName: '', provider: 'openai' as Provider, modelId: '', baseUrl: '', apiKey: '' });
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<Record<string, number>>({});
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [demoModels, setDemoModels] = useState<DemoModel[]>([]);
  const [demoLoaded, setDemoLoaded] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const turnsRef = useRef<Turn[]>([]);
  const chatIdRef = useRef<string | null>(null);
  const titleRef = useRef<string | null>(null);
  const createdRef = useRef<string | null>(null);
  const initialLoad = useRef(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds)); }, [selectedIds]);
  useEffect(() => {
    api<DemoModel[]>('/demo/models')
      .then((list) => { setDemoModels(list); setDemoLoaded(true); })
      .catch(() => setDemoLoaded(true));
  }, []);
  const demoAsConfigs = useMemo((): ModelConfig[] => demoModels.map((demo) => ({
    id: demo.id, displayName: demo.displayName, provider: 'timeweb', modelId: demo.modelId,
    baseUrl: null, inputPrice: null, outputPrice: null, priceUnit: 1000000, currency: 'USD',
  })), [demoModels]);
  const allModels = useMemo(() => [...models, ...demoAsConfigs], [models, demoAsConfigs]);
  const demoLabel = useMemo(() => new Map(demoModels.map((demo) => [demo.id, demo.providerLabel])), [demoModels]);
  const labelFor = (model: ModelConfig) => demoLabel.get(model.id) || providerName(model);
  useEffect(() => {
    if (!demoLoaded) return;
    setSelectedIds((current) => current.filter((id) => allModels.some((m) => m.id === id)).slice(0, MAX_MODELS));
  }, [allModels, demoLoaded]);
  useEffect(() => { threadEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns.length, running]);

  const selectedModels = useMemo(
    () => selectedIds.map((id) => allModels.find((m) => m.id === id)).filter((m): m is ModelConfig => Boolean(m)),
    [selectedIds, allModels],
  );
  const viewModels = useMemo((): ModelConfig[] => {
    if (!viewOnly) return [];
    const seen = new Map<string, ModelConfig>();
    for (const turn of turns) {
      for (const r of turn.results) {
        if (!seen.has(r.modelConfigId)) {
          seen.set(r.modelConfigId, { id: r.modelConfigId, displayName: r.modelName, provider: r.provider, modelId: r.modelId, inputPrice: null, outputPrice: null, priceUnit: 1000000, currency: r.currency || 'USD' });
        }
      }
    }
    return [...seen.values()];
  }, [viewOnly, turns]);
  const columnModels = viewOnly ? viewModels : selectedModels;
  const canAdd = selectedIds.length < MAX_MODELS && !viewOnly;

  const available = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allModels.filter((model) => {
      if (selectedIds.includes(model.id)) return false;
      if (!needle) return true;
      return `${model.displayName} ${labelFor(model)} ${model.modelId}`.toLowerCase().includes(needle);
    });
  }, [allModels, selectedIds, query, demoLabel]);

  const updateResult = (turnId: string, modelConfigId: string, result: ModelResult) =>
    setTurns((current) => current.map((turn) => turn.id === turnId
      ? { ...turn, results: turn.results.map((r) => (r.modelConfigId === modelConfigId ? result : r)) }
      : turn));

  const generate = async (model: ModelConfig, turn: Turn): Promise<ModelResult> => {
    const key = turn.id + model.id;
    controllers.current.get(key)?.abort();
    const controller = new AbortController();
    controllers.current.set(key, controller);
    let result: ModelResult = { ...resultFromModel(model), status: 'streaming' };
    updateResult(turn.id, model.id, result);
    const demo = isDemoModel(model.id);
    const guestKey = user || demo ? undefined : getGuestKey(model.id);
    if (!user && !demo && !guestKey) {
      result = { ...result, status: 'error', error: 'Ключ недоступен после перезагрузки. Введите его снова на странице «Модели».' };
      updateResult(turn.id, model.id, result);
      return result;
    }
    const history = buildHistory(turnsRef.current.filter((item) => item.id !== turn.id), model.id, turn.prompt);
    const modelPayload = demo ? { demoModelId: model.id } : user ? { modelConfigId: model.id } : { ...model, apiKey: guestKey };
    try {
      await streamJson('/generate', { model: modelPayload, messages: history }, controller.signal, (event) => {
        if (event.type === 'text') {
          result = { ...result, response: result.response + event.text, firstTokenMs: event.firstTokenMs };
        } else if (event.type === 'done') {
          result = { ...result, status: 'done', firstTokenMs: event.firstTokenMs, totalMs: event.totalMs, inputTokens: event.inputTokens, outputTokens: event.outputTokens, tokenEstimated: event.estimated, cost: event.cost, currency: event.currency || result.currency };
        } else if (event.type === 'error' || event.type === 'cancelled') {
          result = { ...result, status: event.type, error: event.error, totalMs: event.totalMs };
        }
        updateResult(turn.id, model.id, result);
      });
    } catch (error) {
      result = { ...result, status: controller.signal.aborted ? 'cancelled' : 'error', error: controller.signal.aborted ? 'Генерация отменена' : error instanceof Error ? error.message : 'Ошибка' };
      updateResult(turn.id, model.id, result);
    } finally {
      controllers.current.delete(key);
    }
    return result;
  };

  const persist = async (text: string, outcomes: ModelResult[], allTurns: Turn[]) => {
    if (user) {
      try {
        const saved = await api<{ chatId: string; comparisonId: string }>('/comparisons', { method: 'POST', body: JSON.stringify({ chatId: chatIdRef.current || undefined, prompt: text, results: outcomes }) });
        if (!chatIdRef.current) {
          chatIdRef.current = saved.chatId;
          setChatId(saved.chatId);
          titleRef.current = text.slice(0, 60);
          window.history.replaceState(null, '', `/x/?c=${saved.chatId}`);
        }
        void onRefresh();
      } catch (error) { console.error(error); }
    } else {
      const nowIso = new Date().toISOString();
      const id = chatIdRef.current || crypto.randomUUID();
      if (!chatIdRef.current) {
        chatIdRef.current = id;
        setChatId(id);
        titleRef.current = text.slice(0, 60);
        createdRef.current = nowIso;
        window.history.replaceState(null, '', `/x/?c=${id}`);
      }
      const chat: Chat = {
        id,
        title: titleRef.current || text.slice(0, 60),
        createdAt: createdRef.current || nowIso,
        updatedAt: nowIso,
        comparisons: allTurns.map((t) => ({ id: t.id, prompt: t.prompt, createdAt: createdRef.current || nowIso, results: t.results })),
      };
      saveGuestChats([chat, ...loadGuestChats().filter((item) => item.id !== id)]);
      // Дублируем на сервер, чтобы read-only ссылка на чат открывалась у других людей.
      void api('/shared', { method: 'POST', body: JSON.stringify(chat) }).catch(() => undefined);
      void onRefresh();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || selectedModels.length < MIN_MODELS || running || viewOnly) return;
    setPrompt('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setRunning(true);
    const turn: Turn = { id: crypto.randomUUID(), prompt: text, results: selectedModels.map(resultFromModel) };
    const nextTurns = [...turnsRef.current, turn];
    setTurns(nextTurns);
    const outcomes = await Promise.all(selectedModels.map((model) => generate(model, turn)));
    setRunning(false);
    const finalTurns = nextTurns.map((item) => (item.id === turn.id ? { ...item, results: outcomes } : item));
    setTurns(finalTurns);
    await persist(text, outcomes, finalTurns);
  };

  const retry = (turn: Turn, modelConfigId: string) => {
    const model = allModels.find((m) => m.id === modelConfigId);
    if (model) void generate(model, turn);
  };

  const stopAll = () => controllers.current.forEach((controller) => controller.abort());

  const removeModel = (id: string) => {
    controllers.current.forEach((controller, key) => { if (key.endsWith(id)) controller.abort(); });
    setSelectedIds((current) => current.filter((item) => item !== id));
    setTurns((current) => current.map((turn) => ({ ...turn, results: turn.results.filter((r) => r.modelConfigId !== id) })));
  };

  const addModel = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id) || current.length >= MAX_MODELS) return current;
      const next = [...current, id];
      if (next.length >= MAX_MODELS) setPickerOpen(false);
      return next;
    });
  };

  const openPicker = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 340;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 8, window.innerHeight - 120);
    setPickerPos({ top, left });
    setQuery('');
    setCustomOpen(false);
    setPickerOpen(true);
  };

  const pickerDrag = useRef<{ dx: number; dy: number } | null>(null);
  const onPickerDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const picker = (event.currentTarget.closest('.xp-picker') as HTMLElement | null);
    if (!picker) return;
    const rect = picker.getBoundingClientRect();
    pickerDrag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPickerDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pickerDrag.current) return;
    const picker = (event.currentTarget.closest('.xp-picker') as HTMLElement | null);
    const height = picker?.offsetHeight || 400;
    const top = Math.max(8, Math.min(event.clientY - pickerDrag.current.dy, window.innerHeight - height - 8));
    const left = Math.max(8, Math.min(event.clientX - pickerDrag.current.dx, window.innerWidth - 340 - 8));
    setPickerPos({ top, left });
  };
  const onPickerDragEnd = () => { pickerDrag.current = null; };

  const addCustomModel = async (event: FormEvent) => {
    event.preventDefault();
    const model: ModelConfig = {
      id: crypto.randomUUID(),
      displayName: custom.displayName.trim() || custom.modelId.trim(),
      provider: custom.provider,
      modelId: custom.modelId.trim(),
      baseUrl: (custom.provider === 'timeweb' || custom.provider === 'custom') ? custom.baseUrl.trim() || null : null,
      apiKey: custom.apiKey.trim(),
      inputPrice: null, outputPrice: null, priceUnit: 1000000, currency: 'USD',
    };
    if (!model.modelId || !model.apiKey) return;
    saveGuestModels([...loadGuestModels(), model]);
    setGuestKey(model.id, model.apiKey);
    setCustom({ displayName: '', provider: 'openai', modelId: '', baseUrl: '', apiKey: '' });
    setCustomOpen(false);
    await onRefresh();
    addModel(model.id);
  };

  const copyLink = async () => {
    try {
      const url = chatIdRef.current
        ? `${window.location.origin}/x/?c=${chatIdRef.current}&view=1`
        : window.location.href;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* буфер недоступен */ }
  };

  const reset = () => {
    stopAll();
    controllers.current.clear();
    setTurns([]);
    setChatId(null);
    chatIdRef.current = null;
    titleRef.current = null;
    createdRef.current = null;
    setRunning(false);
    setViewOnly(false);
    window.history.replaceState(null, '', '/x/');
  };

  const openChat = async (id: string, shared = false) => {
    stopAll();
    try {
      let value: Chat | null = null;
      if (user) value = await api<Chat>(`/chats/${id}`).catch(() => null);
      else value = loadGuestChats().find((item) => item.id === id) || null;
      if (!value && shared) value = await api<Chat>(`/shared/${id}`).catch(() => null);
      if (!value) return;
      const chat = normalizeChat(value);
      chatIdRef.current = chat.id;
      setChatId(chat.id);
      titleRef.current = chat.title;
      createdRef.current = chat.createdAt;
      setTurns(chat.comparisons.map((c) => ({ id: c.id, prompt: c.prompt, results: c.results })));
      const last = chat.comparisons[chat.comparisons.length - 1];
      if (!shared) setSelectedIds((last?.results.map((r) => r.modelConfigId) || []).filter((mid) => allModels.some((m) => m.id === mid)).slice(0, MAX_MODELS));
      setViewOnly(shared);
      window.history.replaceState(null, '', shared ? `/x/?c=${chat.id}&view=1` : `/x/?c=${chat.id}`);
      setSideOpen(false);
    } catch (error) { console.error(error); }
  };

  useEffect(() => {
    if (initialLoad.current) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('c');
    if (!id) return;
    const shared = params.get('view') === '1';
    if (shared || chats.some((chat) => chat.id === id)) {
      initialLoad.current = true;
      void openChat(id, shared);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, user]);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    reset();
    await onRefresh(null);
  };

  const toggleThinking = (resultId: string) =>
    setExpandedThinking((current) => {
      const next = new Set(current);
      if (next.has(resultId)) next.delete(resultId); else next.add(resultId);
      return next;
    });

  const getBadges = (turn: Turn): Badges => {
    const done = turn.results.filter((r) => r.status === 'done');
    const withTime = done.filter((r) => r.totalMs != null);
    const withCost = done.filter((r) => r.cost != null);
    return {
      fastest: withTime.length > 1 ? withTime.reduce((a, b) => ((a.totalMs ?? Infinity) <= (b.totalMs ?? Infinity) ? a : b)).id : null,
      cheapest: withCost.length > 1 ? withCost.reduce((a, b) => ((a.cost ?? Infinity) <= (b.cost ?? Infinity) ? a : b)).id : null,
    };
  };

  const contentCols = Math.max(columnModels.length, 1);
  const totalCols = columnModels.length + (canAdd ? 1 : 0);
  const gridTemplate = { gridTemplateColumns: `repeat(${Math.max(totalCols, 1)}, minmax(230px, 1fr))` };

  return <div className="xp">
    {sideOpen && <button className="xp-side-scrim" onClick={() => setSideOpen(false)} aria-label="Закрыть меню" />}
    <aside className={`xp-side ${sideOpen ? 'open' : ''}`}>
      <div className="xp-side-head">
        <div className="xp-brand"><Columns3 size={18} strokeWidth={2.4} /><span>LLM Compare</span></div>
        <button className="xp-icon-btn xp-side-close" onClick={() => setSideOpen(false)} aria-label="Закрыть"><X size={18} /></button>
      </div>
      <button className="xp-side-new" onClick={() => { reset(); setSideOpen(false); }}><MessageSquarePlus size={16} />Новое сравнение</button>
      <Link className="xp-side-link" to="/"><PanelLeft size={16} />Классический интерфейс</Link>
      <div className="xp-side-title">История</div>
      <div className="xp-side-history">
        {chats.length ? chats.map((chat) => (
          <button key={chat.id} className={`xp-side-chat ${chat.id === chatId ? 'active' : ''}`} onClick={() => void openChat(chat.id)}>
            <span>{chat.title}</span>
            <small>{new Date(chat.updatedAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</small>
          </button>
        )) : <div className="xp-side-empty">История появится после первого запроса</div>}
      </div>
      <div className="xp-side-footer">
        <div className="xp-profile-wrap">
          <button className="xp-profile" onClick={() => user && setAccountOpen(!accountOpen)}>
            <span className="xp-avatar">{user?.name?.[0]?.toUpperCase() || 'G'}</span>
            <span className="xp-profile-copy">
              <strong>{user?.name || 'Guest'}</strong>
              <small>{user?.email || 'История в этом браузере'}</small>
            </span>
            {user ? <ChevronDown size={15} /> : null}
          </button>
          {user && accountOpen && <div className="xp-account-menu">
            <button onClick={() => { setAccountOpen(false); void logout(); }}><LogOut size={15} />Выйти</button>
          </div>}
        </div>
        {!user && <button className="xp-login" onClick={() => setAuthOpen(true)}><LogIn size={15} />Войти</button>}
      </div>
    </aside>

    <div className="xp-body">
      <header className="xp-top">
        <button className="xp-icon-btn xp-burger" onClick={() => setSideOpen(true)} aria-label="Меню"><Menu size={20} /></button>
        <div className="xp-brand xp-top-brand"><Columns3 size={18} strokeWidth={2.4} /><span>LLM Compare</span></div>
        <div className="xp-top-actions">
          <button className="xp-link-button" onClick={copyLink}>
            {copied ? <Check size={15} /> : <Link2 size={15} />}{copied ? 'Скопировано' : 'Скопировать ссылку'}
          </button>
          <button className="xp-new-button" onClick={reset}>Новое сравнение</button>
        </div>
      </header>

      <div className="xp-scroll">
        <div className="xp-main">
          {!selectedModels.length && !turns.length && <section className="xp-welcome">
            <h1>Сравните ответы моделей</h1>
            <p>Добавьте от двух до четырёх моделей и задайте один вопрос — ответы появятся рядом, колонка к колонке.</p>
            {canAdd && (
              <button className="xp-add-button xp-add-welcome" onClick={openPicker}>
                <span className="xp-add-circle"><Plus size={19} /></span>
                Добавить модель
              </button>
            )}
          </section>}
          <div className="xp-heads" style={isMobile ? undefined : gridTemplate}>
            {columnModels.map((model) => (
              <div key={model.id} className="xp-head-cell">
                <div className="xp-model-card">
                  <div className="xp-model-card-text">
                    <strong>{model.displayName}</strong>
                    <small>{labelFor(model)}</small>
                  </div>
                  {!viewOnly && <button className="xp-icon-btn" onClick={() => removeModel(model.id)} aria-label="Убрать модель"><X size={14} /></button>}
                </div>
              </div>
            ))}
            {canAdd && <div className="xp-head-cell xp-heads-spacer" aria-hidden="true" />}
          </div>
          <div className="xp-turns" style={isMobile ? undefined : gridTemplate}>
            {canAdd && !isMobile && (
              <div className="xp-add-cell" style={{ gridColumn: columnModels.length + 1, gridRow: `1 / ${Math.max(turns.length * 2, 1) + 1}` }}>
                <button className="xp-add-button" onClick={openPicker}>
                  <span className="xp-add-circle"><Plus size={19} /></span>
                  Добавить модель
                </button>
              </div>
            )}
            {turns.map((turn, turnIndex) => {
              const badges = getBadges(turn);
              const bubbleRow = turnIndex * 2 + 1;
              const answersRow = bubbleRow + 1;
              const active = Math.min(mobileTab[turn.id] ?? 0, Math.max(turn.results.length - 1, 0));
              return <Fragment key={turn.id}>
                <div className="xp-bubble-cell" style={isMobile ? undefined : { gridColumn: `1 / ${contentCols + 1}`, gridRow: bubbleRow }}>
                  <div className="xp-bubble">{turn.prompt}</div>
                </div>
                {turn.results.length > 0 && <div className="xp-tabs">
                  {turn.results.map((result, index) => (
                    <button key={result.id} className={index === active ? 'active' : ''} onClick={() => setMobileTab((current) => ({ ...current, [turn.id]: index }))}>
                      {result.modelName}
                    </button>
                  ))}
                  {canAdd && <button className="xp-tabs-add" onClick={openPicker} aria-label="Добавить модель"><Plus size={14} /></button>}
                </div>}
                {turn.results.map((result, index) => {
                  const column = columnModels.findIndex((m) => m.id === result.modelConfigId) + 1;
                  if (!column) return null;
                  return <div
                    key={result.id}
                    className={`xp-answer-cell ${column === 1 ? 'first' : ''} ${isMobile && index !== active ? 'xp-mobile-hidden' : ''}`}
                    style={isMobile ? undefined : { gridColumn: column, gridRow: answersRow }}
                  >
                    <AnswerContent
                      result={result}
                      badges={badges}
                      readOnly={viewOnly}
                      thinkingExpanded={expandedThinking.has(result.id)}
                      onToggleThinking={() => toggleThinking(result.id)}
                      onRetry={() => retry(turn, result.modelConfigId)}
                    />
                  </div>;
                })}
              </Fragment>;
            })}
          </div>
          <div ref={threadEnd} />
        </div>
      </div>

      {viewOnly ? (
        <div className="xp-composer-dock">
          <div className="xp-viewnote">Режим просмотра: по этой ссылке чат доступен только для чтения</div>
        </div>
      ) : (
      <div className="xp-composer-dock">
        <form className="xp-composer" onSubmit={(event) => { void submit(event); }}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
            placeholder={allModels.length ? 'Задайте вопрос всем моделям' : 'Сначала подключите модель'}
            rows={1}
            disabled={!allModels.length}
          />
          {running
            ? <button type="button" className="xp-send stop" onClick={stopAll} aria-label="Остановить"><CircleStop size={17} /></button>
            : <button className="xp-send" disabled={!prompt.trim() || selectedModels.length < MIN_MODELS} aria-label="Отправить"><ArrowUp size={18} strokeWidth={2.5} /></button>}
        </form>
        {selectedModels.length < MIN_MODELS && <div className="xp-hint">Для сравнения нужно от {MIN_MODELS} до {MAX_MODELS} моделей</div>}
      </div>
      )}
    </div>

    {pickerOpen && (
      <div className="xp-scrim" onClick={() => setPickerOpen(false)}>
        <div className="xp-picker" style={pickerPos ? { top: pickerPos.top, left: pickerPos.left } : undefined} onClick={(e) => e.stopPropagation()}>
          <div className="xp-picker-head" onPointerDown={onPickerDragStart} onPointerMove={onPickerDragMove} onPointerUp={onPickerDragEnd} onPointerCancel={onPickerDragEnd}>
            <strong>Добавить модель</strong>
            <button className="xp-icon-btn" onClick={() => setPickerOpen(false)} aria-label="Закрыть"><X size={16} /></button>
          </div>
          <label className="xp-search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти модель" autoFocus />
          </label>
          <div className="xp-picker-list">
            {available.length ? available.map((model) => (
              <button key={model.id} className="xp-picker-row" onClick={() => addModel(model.id)}>
                <span className="xp-picker-row-text">
                  <strong>{model.displayName}</strong>
                  <small>{labelFor(model)}</small>
                </span>
                <Plus size={16} />
              </button>
            )) : <div className="xp-picker-empty">{allModels.length ? 'Ничего не найдено' : 'Добавьте свою модель ниже'}</div>}
          </div>
          {!user && (
            customOpen ? (
              <form className="xp-custom" onSubmit={(e) => { void addCustomModel(e); }}>
                <input required value={custom.displayName} onChange={(e) => setCustom({ ...custom, displayName: e.target.value })} placeholder="Название (например, GPT-4o mini)" />
                <select value={custom.provider} onChange={(e) => setCustom({ ...custom, provider: e.target.value as Provider })}>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="timeweb">Timeweb Cloud</option>
                  <option value="custom">Свой сервер (OpenAI-совместимый)</option>
                </select>
                <input required value={custom.modelId} onChange={(e) => setCustom({ ...custom, modelId: e.target.value })} placeholder={`Идентификатор модели: ${MODEL_ID_HINTS[custom.provider]}`} />
                <small className="xp-custom-hint">Идентификатор — это имя модели, которое провайдер ждёт в запросе. Оно указано в документации провайдера или в панели рядом с API-ключом.</small>
                {custom.provider === 'timeweb' && (
                  <input type="url" value={custom.baseUrl} onChange={(e) => setCustom({ ...custom, baseUrl: e.target.value })} placeholder="Base URL (https://api.timeweb.ai/v1)" />
                )}
                {custom.provider === 'custom' && (
                  <>
                    <input required type="url" value={custom.baseUrl} onChange={(e) => setCustom({ ...custom, baseUrl: e.target.value })} placeholder="https://my-server.example/v1" />
                    <small className="xp-custom-hint">Прямая ссылка на OpenAI-совместимый API: Ollama, vLLM, LM Studio или своя модель на своём сервере. `/chat/completions` добавим автоматически.</small>
                  </>
                )}
                <input required type="password" value={custom.apiKey} onChange={(e) => setCustom({ ...custom, apiKey: e.target.value })} placeholder={custom.provider === 'custom' ? 'API-ключ (если сервер без ключа — любой текст)' : 'API-ключ (хранится только в браузере)'} />
                <div className="xp-custom-actions">
                  <button type="button" className="xp-custom-cancel" onClick={() => setCustomOpen(false)}>Отмена</button>
                  <button type="submit" className="xp-custom-save">Добавить</button>
                </div>
              </form>
            ) : (
              <button className="xp-custom-toggle" onClick={() => setCustomOpen(true)}><Plus size={15} />Своя модель</button>
            )
          )}
          <div className="xp-picker-foot">В сравнении может быть от {MIN_MODELS} до {MAX_MODELS} моделей</div>
        </div>
      </div>
    )}

    {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onSuccess={async (nextUser) => { setAuthOpen(false); await onRefresh(nextUser); }} />}
  </div>;
}

function AnswerContent({ result, badges, readOnly, thinkingExpanded, onToggleThinking, onRetry }: { result: ModelResult; badges: Badges; readOnly: boolean; thinkingExpanded: boolean; onToggleThinking: () => void; onRetry: () => void }) {
  if (result.status === 'error') {
    return <div className="xp-error-card">
      <Info size={19} />
      <strong>Модель не ответила</strong>
      <p>{readOnly ? 'Эта модель не дала ответа на вопрос.' : 'Остальные ответы сохранены. Можно повторить запрос для этой модели.'}</p>
      {result.error && <small>{result.error}</small>}
      {!readOnly && <button className="xp-retry" onClick={onRetry}><RefreshCw size={14} />Повторить</button>}
    </div>;
  }
  return <>
    {result.status === 'streaming' && result.firstTokenMs == null && (
      <div className="xp-thinking live"><span>Thinking</span><span className="xp-dots"><i /><i /><i /></span></div>
    )}
    {result.firstTokenMs != null && <>
      <button className="xp-thinking" onClick={onToggleThinking}>
        <Clock3 size={14} />
        <span>Думала {thinkingLabel(result.firstTokenMs)}</span>
        {thinkingExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {thinkingExpanded && <div className="xp-thinking-detail">
        Модель размышляла {thinkingLabel(result.firstTokenMs)} перед началом ответа. Поток размышлений текущий API не передаёт, поэтому здесь показана длительность.
      </div>}
    </>}
    {result.response && (
      <div className="xp-markdown">
        <MarkdownView text={result.response} />
        {result.status === 'streaming' && <span className="xp-caret" />}
      </div>
    )}
    {result.status === 'cancelled' && <p className="xp-muted-line">Генерация отменена</p>}
    {(badges.fastest === result.id || badges.cheapest === result.id) && (
      <div className="xp-badges">
        {badges.fastest === result.id && <span className="xp-badge">Самая быстрая</span>}
        {badges.cheapest === result.id && <span className="xp-badge">Самая дешёвая</span>}
      </div>
    )}
    {result.status === 'done' && (result.totalMs != null || result.cost != null) && <>
      <div className="xp-stats">
        {result.totalMs != null && formatSeconds(result.totalMs)}
        {result.cost != null && ` · ${currencySymbol(result.currency)}${result.cost.toFixed(4).replace('.', ',')}`}
      </div>
      <div className="xp-stats-sub">
        {result.firstTokenMs != null && `1-й токен ${formatSeconds(result.firstTokenMs)}`}
        {result.inputTokens != null && result.outputTokens != null && ` · токены ${result.inputTokens} / ${result.outputTokens}`}
      </div>
    </>}
  </>;
}

function MarkdownView({ text }: { text: string }) {
  return <ReactMarkdown
    skipHtml
    remarkPlugins={[remarkGfm]}
    components={{
      a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
      pre: ({ children }) => <>{children}</>,
      code: ({ className, children }) => {
        const value = String(children).replace(/\n$/, '');
        const match = /language-([\w-]+)/.exec(className || '');
        if (!match) return <code className="xp-inline-code">{value}</code>;
        return <CodeBlock lang={match[1]} code={value} />;
      },
    }}
  >{text}</ReactMarkdown>;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* буфер недоступен */ }
  };
  return <div className="xp-code">
    <div className="xp-code-head">
      <span>{lang}</span>
      <button type="button" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}Copy</button>
    </div>
    <pre><code>{code}</code></pre>
  </div>;
}
