import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api';
import type { User } from '../types';

export function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await api<{ user: User }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(data) }); onSuccess(result.user); }
    catch (err) { setError(err instanceof Error ? err.message : 'Ошибка'); }
    finally { setBusy(false); }
  };
  return <div className="modal-scrim" role="dialog" aria-modal="true">
    <div className="modal auth-modal">
      <button className="icon-button modal-close" onClick={onClose}><X size={19} /></button>
      <h2>{mode === 'login' ? 'С возвращением' : 'Создать аккаунт'}</h2>
      <p className="muted">Синхронизируйте модели, чаты и аналитику.</p>
      <form onSubmit={submit} className="stack-form">
        {mode === 'register' && <label>Имя<input name="name" required minLength={2} autoFocus /></label>}
        <label>Email<input name="email" required type="email" autoFocus={mode === 'login'} /></label>
        <label>Пароль<input name="password" required type="password" minLength={8} /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="button dark" disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
      </form>
      <button className="text-button auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
        {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
      </button>
    </div>
  </div>;
}
