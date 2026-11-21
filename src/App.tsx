import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import { clearGuestData, loadGuestChats, loadGuestModels } from './lib/guest';
import type { ChatSummary, ModelConfig, User } from './types';
import { AppShell } from './components/AppShell';
import { AuthModal } from './components/AuthModal';
import { ChatPage } from './pages/ChatPage';
import { ModelsPage } from './pages/ModelsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AdminPage } from './pages/AdminPage';
import { XPage } from './pages/XPage';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async (knownUser?: User | null) => {
    const actualUser = knownUser === undefined ? (await api<{ user: User | null }>('/auth/me')).user : knownUser;
    setUser(actualUser);
    if (actualUser) {
      const [remoteModels, remoteChats] = await Promise.all([api<ModelConfig[]>('/models'), api<ChatSummary[]>('/chats')]);
      setModels(remoteModels); setChats(remoteChats);
    } else {
      setModels(loadGuestModels());
      setChats(loadGuestChats().map(({ comparisons: _comparisons, ...chat }) => chat).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    }
    setReady(true);
  }, []);

  useEffect(() => { refresh().catch(() => setReady(true)); }, [refresh]);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    await refresh(null); navigate('/');
  };

  const clearGuest = () => {
    if (!confirm('Удалить всю гостевую историю и конфигурации моделей?')) return;
    clearGuestData(); setModels([]); setChats([]); navigate('/');
  };

  if (!ready) return <div className="center-screen"><span className="spinner" />Загружаем рабочее пространство…</div>;

  if (location.pathname === '/x' || location.pathname === '/x/') return <XPage user={user} models={models} chats={chats} onRefresh={refresh} />;

  return <>
    <AppShell user={user} chats={chats} onLogin={() => setAuthOpen(true)} onLogout={logout} onClearGuest={clearGuest}>
      <Routes>
        <Route path="/" element={<ChatPage user={user} models={models} onDataChanged={() => refresh(user)} />} />
        <Route path="/chat/:chatId" element={<ChatPage user={user} models={models} onDataChanged={() => refresh(user)} />} />
        <Route path="/models" element={<ModelsPage user={user} models={models} onChanged={() => refresh(user)} />} />
        <Route path="/analytics" element={<AnalyticsPage user={user} models={models} />} />
        <Route path="/admin" element={user?.isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
    {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onSuccess={async (nextUser) => { setAuthOpen(false); await refresh(nextUser); }} />}
  </>;
}
