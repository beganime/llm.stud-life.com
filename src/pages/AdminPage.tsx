import { useEffect, useState, type ReactNode } from 'react';
import { Activity, Bot, Database, MessageSquare, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { api } from '../lib/api';

type AdminOverview = {
  generatedAt: string;
  totals: { users: number; chats: number; comparisons: number; results: number; modelConfigurations: number; evaluated: number };
  providers: { provider: string; configurations: number; users: number }[];
  recentUsers: { id: string; name: string; email: string; isAdmin: number; createdAt: string; modelCount: number; chatCount: number; resultCount: number }[];
  recentRuns: { id: string; prompt: string; createdAt: string; email: string; resultCount: number; completedCount: number }[];
};

const providerNames: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', timeweb: 'Timeweb Cloud' };

export function AdminPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true); setError('');
    try { setData(await api<AdminOverview>('/admin/overview')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось загрузить данные'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return <div className="page page-wide admin-page">
    <header className="page-header"><div><div className="eyebrow"><ShieldCheck size={15} />Только для администратора</div><h1>Админ-панель</h1><p>Пользователи, подключения моделей и активность сервиса. API-ключи здесь никогда не отображаются.</p></div>
      <button className="button" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? 'rotating' : ''} />Обновить</button>
    </header>
    {error && <div className="form-error">{error}</div>}
    {loading && !data ? <div className="admin-loading"><span className="spinner" />Загружаем метрики…</div> : data && <>
      <div className="admin-stat-grid">
        <AdminStat icon={<Users />} label="Пользователи" value={data.totals.users} detail={`${data.totals.modelConfigurations} конфигураций моделей`} />
        <AdminStat icon={<MessageSquare />} label="Чаты" value={data.totals.chats} detail={`${data.totals.comparisons} сравнений`} />
        <AdminStat icon={<Bot />} label="Ответы моделей" value={data.totals.results} detail={`${data.totals.evaluated} с оценкой`} />
        <AdminStat icon={<Activity />} label="Состояние" value="Работает" detail={`Обновлено ${new Date(data.generatedAt).toLocaleTimeString('ru-RU')}`} />
      </div>
      <div className="admin-layout">
        <section className="admin-card provider-admin-card"><div className="card-title"><div><h2>Подключённые провайдеры</h2><p>Любые модели внутри поддерживаемых API</p></div><Database size={17} /></div>
          {data.providers.length ? <div className="admin-provider-list">{data.providers.map((provider) => <div key={provider.provider}><span className="provider-glyph">{(providerNames[provider.provider] || provider.provider)[0]}</span><span><strong>{providerNames[provider.provider] || provider.provider}</strong><small>{provider.users} пользователей</small></span><b>{provider.configurations}</b></div>)}</div> : <div className="compact-empty">Модели пока не подключены</div>}
        </section>
        <section className="admin-card admin-users-card"><div className="card-title"><div><h2>Пользователи</h2><p>Последние 50 регистраций</p></div></div>
          <div className="admin-table-wrap"><table><thead><tr><th>Пользователь</th><th>Роль</th><th>Модели</th><th>Чаты</th><th>Ответы</th><th>Регистрация</th></tr></thead><tbody>{data.recentUsers.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.isAdmin ? <span className="admin-role">Администратор</span> : 'Пользователь'}</td><td>{user.modelCount}</td><td>{user.chatCount}</td><td>{user.resultCount}</td><td>{new Date(user.createdAt).toLocaleDateString('ru-RU')}</td></tr>)}</tbody></table></div>
        </section>
        <section className="admin-card admin-runs-card"><div className="card-title"><div><h2>Последние сравнения</h2><p>Без содержимого ключей и системных секретов</p></div></div>
          {data.recentRuns.length ? <div className="admin-runs">{data.recentRuns.map((run) => <div key={run.id}><span><strong>{run.prompt}</strong><small>{run.email} · {new Date(run.createdAt).toLocaleString('ru-RU')}</small></span><b>{run.completedCount}/{run.resultCount}</b></div>)}</div> : <div className="compact-empty">Сравнений пока нет</div>}
        </section>
      </div>
    </>}
  </div>;
}

function AdminStat({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string | number; detail: string }) {
  return <div className="admin-stat"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></div>;
}
