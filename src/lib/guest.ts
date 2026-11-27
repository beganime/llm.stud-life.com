import type { Chat, ModelConfig } from '../types';

const MODELS = 'llmc_guest_models_v1';
const CHATS = 'llmc_guest_chats_v1';
const KEYS = 'llmc_guest_keys_v1';

export function loadGuestModels(): ModelConfig[] {
  try { return JSON.parse(localStorage.getItem(MODELS) || '[]'); } catch { return []; }
}
export function saveGuestModels(models: ModelConfig[]) {
  localStorage.setItem(MODELS, JSON.stringify(models.map(({ apiKey: _apiKey, ...model }) => model)));
}

// Ключи гостя хранятся в localStorage браузера (обфусцированы base64), чтобы модели
// продолжали работать после перезагрузки страницы. С сервера они недоступны никому.
function loadKeys(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEYS) || '{}'); } catch { return {}; }
}
export function setGuestKey(id: string, key: string) {
  if (!key) return;
  const all = loadKeys();
  all[id] = btoa(unescape(encodeURIComponent(key)));
  localStorage.setItem(KEYS, JSON.stringify(all));
}
export function getGuestKey(id: string) {
  const value = loadKeys()[id];
  if (!value) return undefined;
  try { return decodeURIComponent(escape(atob(value))); } catch { return undefined; }
}
export function deleteGuestKey(id: string) {
  const all = loadKeys();
  delete all[id];
  localStorage.setItem(KEYS, JSON.stringify(all));
}

export function loadGuestChats(): Chat[] {
  try { return JSON.parse(localStorage.getItem(CHATS) || '[]'); } catch { return []; }
}
export function saveGuestChats(chats: Chat[]) { localStorage.setItem(CHATS, JSON.stringify(chats)); }
export function clearGuestData() { localStorage.removeItem(MODELS); localStorage.removeItem(CHATS); localStorage.removeItem(KEYS); }
