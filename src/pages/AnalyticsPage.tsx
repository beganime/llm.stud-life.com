import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BarChart3, CalendarDays, ChevronRight, CircleDollarSign, Clock3, MessageSquare, Sparkles, Star, Trophy, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { loadGuestChats } from '../lib/guest';
import type { AnalyticsRow, ModelConfig, User } from '../types';

export function AnalyticsPage({ user, models }: { user: User | null; models: ModelConfig[] }) {
  const [rows, setRows] = useState<AnalyticsRow[]>([]); const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30'); const [model, setModel] = useState(''); const [chat, setChat] = useState('');
  useEffect(() => {
    const load = user ? api<AnalyticsRow[]>('/analytics') : Promise.resolve(guestAnalytics());
    load.then(setRows).finally(() => setLoading(false));
  }, [user]);
  const filtered = useMemo(() => rows.filter((row) => {
    const after = period === 'all' ? 0 : Date.now() - Number(period) * 864e5;
    return new Date(row.created_at).getTime() >= after && (!model || row.model_name === model) && (!chat || row.chatId === chat);
  }), [rows, period, model, chat]);
  const grouped = useMemo(() => groupModels(filtered), [filtered]);
  const currencies = useMemo(() => Object.entries(filtered.reduce<Record<string, number>>((acc, row) => { if (row.cost != null) acc[row.currency || '—'] = (acc[row.currency || '—'] || 0) + row.cost; return acc; }, {})), [filtered]);
  const chats = useMemo(() => [...new Map(rows.map((row) => [row.chatId, row.prompt])).entries()], [rows]);

  if (loading) return <div className="center-screen"><span className="spinner" />Собираем аналитику…</div>;
  return <div className="page page-wide analytics-page">
    <header className="page-header"><div><h1>Аналитика</h1><p>Скорость, расходы и качество ответов в одном представлении.</p></div></header>
    <div className="filter-bar">
      <label><CalendarDays size={15} /><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option><option value="all">Всё время</option></select></label>
      <label><BarChart3 size={15} /><select value={model} onChange={(e) => setModel(e.target.value)}><option value="">Все модели</option>{[...new Set(rows.map((r) => r.model_name))].map((name) => <option key={name}>{name}</option>)}</select></label>
      <label><MessageSquare size={15} /><select value={chat} onChange={(e) => setChat(e.target.value)}><option value="">Все чаты</option>{chats.map(([id, title]) => <option value={id} key={id}>{title.slice(0, 40)}</option>)}</select></label>
    </div>
    {!filtered.length ? <div className="empty-panel analytics-empty"><div className="empty-icon"><BarChart3 size={22} /></div><h2>Пока нет данных</h2><p>Отправьте первый запрос модели — здесь появятся скорость, токены, стоимость и качество.</p><Link className="button dark" to="/">Начать сравнение</Link></div> : <>
      <div className="stat-grid">
        <Stat icon={<MessageSquare />} label="Ответов" value={String(filtered.length)} detail={`${new Set(filtered.map((r) => r.chatId + r.prompt)).size} сравнений`} />
        <Stat icon={<Zap />} label="Среднее до ответа" value={average(filtered.map((r) => r.first_token_ms), 'time')} detail="по завершённым запросам" />
        <Stat icon={<Clock3 />} label="Полное время" value={average(filtered.map((r) => r.total_ms), 'time')} detail="среднее на ответ" />
        <Stat icon={<CircleDollarSign />} label="Стоимость" value={currencies.length ? currencies.map(([currency, value]) => `${value.toFixed(4)} ${currency}`).join(' · ') : 'Нет данных'} detail="по указанным тарифам" />
      </div>
      <div className="analytics-grid">
        <section className="analytics-card span-2"><div className="card-title"><div><h2>Сравнение моделей</h2><p>Среднее полное время, секунды</p></div></div><BarChart data={grouped.map((g) => ({ label: g.name, value: g.totalMs / 1000 }))} /></section>
        <section className="analytics-card"><div className="card-title"><div><h2>Качество</h2><p>Пользовательские оценки</p></div></div><div className="quality-summary"><strong>{average(filtered.map((r) => r.rating), 'number')}</strong><span><Star size={15} fill="currentColor" /> средняя оценка</span><div><b>{percent(filtered.filter((r) => r.liked != null).filter((r) => r.liked === 1).length, filtered.filter((r) => r.liked != null).length)}</b><small>ответов подошли</small></div><div><b>{filtered.filter((r) => r.rating != null).length}</b><small>оценено ответов</small></div></div></section>
        <section className="analytics-card span-2"><div className="card-title"><div><h2>Динамика запросов</h2><p>Количество ответов по дням</p></div></div><LineChart rows={filtered} /></section>
        <section className="analytics-card"><div className="card-title"><div><h2>Токены</h2><p>Входные и выходные</p></div></div><div className="token-list">{grouped.map((g) => <div key={g.name}><span>{g.name}</span><strong>{formatNumber(g.inputTokens + g.outputTokens)}</strong><small>{formatNumber(g.inputTokens)} вх. · {formatNumber(g.outputTokens)} исх.</small></div>)}</div></section>
        <section className="analytics-card span-3"><div className="card-title"><div><h2>Качество по моделям</h2><p>Пользовательские и отдельные ИИ-оценки</p></div></div><div className="quality-table-wrap"><table><thead><tr><th>Модель</th><th>Подошли</th><th>Оценка</th><th>Победы</th><th>ИИ: релевантность</th><th>ИИ: полнота</th><th>ИИ: ясность</th><th>ИИ: обоснованность</th></tr></thead><tbody>{grouped.map((g) => <tr key={g.name}><td><strong>{g.name}</strong></td><td>{percent(g.likes, g.ratedLikes)}</td><td>{g.ratingCount ? g.rating.toFixed(1) : '—'}</td><td><Trophy size={13} /> {g.wins}</td><td>{g.aiCount ? g.ai.relevance.toFixed(1) : '—'}</td><td>{g.aiCount ? g.ai.completeness.toFixed(1) : '—'}</td><td>{g.aiCount ? g.ai.clarity.toFixed(1) : '—'}</td><td>{g.aiCount ? g.ai.reasoning.toFixed(1) : '—'}</td></tr>)}</tbody></table></div></section>
      </div>
      <section className="runs-section"><div className="card-title"><div><h2>Последние запуски</h2><p>Нажмите, чтобы открыть сравнение</p></div></div><div className="runs-table"><table><thead><tr><th>Дата</th><th>Запрос</th><th>Модель</th><th>Время</th><th>Токены</th><th>Стоимость</th><th /></tr></thead><tbody>{filtered.slice(0, 50).map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleDateString('ru-RU')}</td><td>{row.prompt.slice(0, 62)}</td><td>{row.model_name}</td><td>{row.total_ms ? `${(row.total_ms / 1000).toFixed(2)} с` : '—'}</td><td>{row.input_tokens != null ? formatNumber((row.input_tokens || 0) + (row.output_tokens || 0)) : '—'}</td><td>{row.cost != null ? `${row.cost.toFixed(5)} ${row.currency}` : '—'}</td><td><Link to={`/chat/${row.chatId}`}><ChevronRight size={17} /></Link></td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}

function Stat({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) { return <div className="stat-card"><span className="stat-icon">{icon}</span><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
function average(values: (number | null | undefined)[], type: 'time' | 'number') { const available = values.filter((v): v is number => v != null); if (!available.length) return 'Нет данных'; const value = available.reduce((a, b) => a + b, 0) / available.length; return type === 'time' ? `${(value / 1000).toFixed(2)} с` : value.toFixed(1); }
function percent(value: number, total: number) { return total ? `${Math.round(value / total * 100)}%` : '—'; }
function formatNumber(value: number) { return new Intl.NumberFormat('ru-RU', { notation: value > 9999 ? 'compact' : 'standard' }).format(value); }

function groupModels(rows: AnalyticsRow[]) {
  const groups = new Map<string, any>();
  rows.forEach((row) => {
    const g = groups.get(row.model_name) || { name: row.model_name, count: 0, totalMsSum: 0, totalMsCount: 0, inputTokens: 0, outputTokens: 0, likes: 0, ratedLikes: 0, rating: 0, ratingCount: 0, wins: 0, ai: { relevance: 0, completeness: 0, clarity: 0, reasoning: 0 }, aiCount: 0 };
    g.count++; if (row.total_ms != null) { g.totalMsSum += row.total_ms; g.totalMsCount++; } g.inputTokens += row.input_tokens || 0; g.outputTokens += row.output_tokens || 0;
    if (row.liked != null) { g.ratedLikes++; g.likes += row.liked; } if (row.rating != null) { g.rating += row.rating; g.ratingCount++; } g.wins += row.is_winner || 0;
    if (row.ai_evaluation) { try { const ai = JSON.parse(row.ai_evaluation); for (const key of ['relevance','completeness','clarity','reasoning']) g.ai[key] += Number(ai[key] || 0); g.aiCount++; } catch {} }
    groups.set(row.model_name, g);
  });
  return [...groups.values()].map((g) => ({ ...g, totalMs: g.totalMsCount ? g.totalMsSum / g.totalMsCount : 0, rating: g.ratingCount ? g.rating / g.ratingCount : 0, ai: Object.fromEntries(Object.entries(g.ai).map(([k, v]) => [k, g.aiCount ? Number(v) / g.aiCount : 0])) }));
}

function BarChart({ data }: { data: { label: string; value: number }[] }) { const max = Math.max(...data.map((d) => d.value), 1); return <div className="bar-chart">{data.map((item) => <div className="bar-row" key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max(2, item.value / max * 100)}%` }} /></div><strong>{item.value.toFixed(2)}</strong></div>)}</div>; }
function LineChart({ rows }: { rows: AnalyticsRow[] }) {
  const dates = new Map<string, number>(); rows.forEach((r) => { const d = r.created_at.slice(0, 10); dates.set(d, (dates.get(d) || 0) + 1); }); const data = [...dates.entries()].sort(); const max = Math.max(...data.map(([, v]) => v), 1);
  const points = data.map(([, value], i) => `${data.length === 1 ? 50 : i / (data.length - 1) * 100},${92 - value / max * 78}`).join(' ');
  return <div className="line-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" x2="100" y1="92" y2="92" /><polyline points={points} />{data.map(([, value], i) => <circle key={i} cx={data.length === 1 ? 50 : i / (data.length - 1) * 100} cy={92 - value / max * 78} r="1.5" />)}</svg><div>{data.map(([date]) => <span key={date}>{new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</span>)}</div></div>;
}
function guestAnalytics(): AnalyticsRow[] { return loadGuestChats().flatMap((chat) => chat.comparisons.flatMap((comparison) => comparison.results.map((result) => ({ id: result.id, model_name: result.modelName, provider: result.provider, prompt: comparison.prompt, chatId: chat.id, response: result.response, first_token_ms: result.firstTokenMs ?? null, total_ms: result.totalMs ?? null, input_tokens: result.inputTokens ?? null, output_tokens: result.outputTokens ?? null, token_estimated: result.tokenEstimated ? 1 : 0, cost: result.cost ?? null, currency: result.currency, liked: result.liked == null ? null : result.liked ? 1 : 0, rating: result.rating ?? null, is_winner: result.isWinner ? 1 : 0, ai_evaluation: result.aiEvaluation ? JSON.stringify(result.aiEvaluation) : null, created_at: comparison.createdAt, status: result.status })))); }
