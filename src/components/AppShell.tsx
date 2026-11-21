import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, ChevronDown, LogIn, LogOut, Menu, MessageSquarePlus, Moon, PanelLeftClose, Settings2, ShieldCheck, Sun, Trash2, X } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { ChatSummary, User } from '../types';

type Props = {
  children: ReactNode; user: User | null; chats: ChatSummary[];
  onLogin: () => void; onLogout: () => void; onClearGuest: () => void;
};

export function AppShell({ children, user, chats, onLogin, onLogout, onClearGuest }: Props) {
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('llmc_theme');
    return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const navigate = useNavigate();
  const close = () => setOpen(false);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    localStorage.setItem('llmc_theme', dark ? 'dark' : 'light');
  }, [dark]);

  return <div className="app-shell">
    <button className="mobile-menu icon-button" onClick={() => setOpen(true)} aria-label="Открыть меню"><Menu size={20} /></button>
    {open && <button className="sidebar-scrim" onClick={close} aria-label="Закрыть меню" />}
    <aside className={`sidebar ${open ? 'is-open' : ''}`}>
      <div className="sidebar-head">
        <button className="brand" onClick={() => { navigate('/'); close(); }} aria-label="LLM Compare"><span className="brand-mark">L</span><span>LLM Compare</span></button>
        <button className="icon-button desktop-close" onClick={close} aria-label="Свернуть"><PanelLeftClose size={18} /></button>
        <button className="icon-button mobile-close" onClick={close} aria-label="Закрыть"><X size={20} /></button>
      </div>
      <NavLink className="new-chat" to="/" onClick={close}><MessageSquarePlus size={17} />Новый чат</NavLink>
      <nav className="main-nav">
        <NavLink to="/models" onClick={close}><Settings2 size={17} />Модели</NavLink>
        <NavLink to="/analytics" onClick={close}><BarChart3 size={17} />Аналитика</NavLink>
        {user?.isAdmin && <NavLink to="/admin" onClick={close}><ShieldCheck size={17} />Админ-панель</NavLink>}
      </nav>
      <div className="history-title">Чаты</div>
      <div className="chat-history">
        {chats.length ? chats.map((chat) => <NavLink key={chat.id} to={`/chat/${chat.id}`} onClick={close} className="chat-row">
          <span>{chat.title}</span><small>{new Date(chat.updatedAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</small>
        </NavLink>) : <div className="sidebar-empty">История появится после первого запроса</div>}
      </div>
      <div className="sidebar-footer">
        <div className="profile-wrap">
          <button className="profile-button" onClick={() => setAccountOpen(!accountOpen)}>
            <span className="avatar">{user?.name?.[0]?.toUpperCase() || 'G'}</span>
            <span className="profile-copy"><strong>{user?.name || 'Guest'}</strong><small>{user?.email || 'История в этом браузере'}</small></span>
            {user ? <ChevronDown size={16} /> : null}
          </button>
          {user && accountOpen && <div className="account-menu"><button onClick={onLogout}><LogOut size={16} />Выйти</button></div>}
        </div>
        <div className="footer-actions">
          <button className="theme-button" onClick={() => setDark(!dark)}>{dark ? <Sun size={16} /> : <Moon size={16} />}<span>{dark ? 'Светлая тема' : 'Тёмная тема'}</span></button>
          {!user && <>
            <button className="login-pill" onClick={onLogin}><LogIn size={15} />Войти</button>
            <button className="icon-button" onClick={onClearGuest} title="Очистить гостевую историю"><Trash2 size={16} /></button>
          </>}
        </div>
      </div>
    </aside>
    <main className="main-content">{children}</main>
  </div>;
}
