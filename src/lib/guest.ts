import type { Chat, ModelConfig } from '../types';

const MODELS = 'llmc_guest_models_v1';
const CHATS = 'llmc_guest_chats_v1';
const memoryKeys = new Map<string, string>();

export function loadGuestModels(): ModelConfig[] {
  try { return JSON.parse(localStorage.getItem(MODELS) || '[]'); } catch { return []; }
}
export function saveGuestModels(models: ModelConfig[]) {
  localStorage.setItem(MODELS, JSON.stringify(models.map(({ apiKey: _apiKey, ...model }) => model)));
}
export function setGuestKey(id: string, key: string) { if (key) memoryKeys.set(id, key); }
export function getGuestKey(id: string) { return memoryKeys.get(id); }
export function deleteGuestKey(id: string) { memoryKeys.delete(id); }

export function loadGuestChats(): Chat[] {
  try { return JSON.parse(localStorage.getItem(CHATS) || '[]'); } catch { return []; }
}
export function saveGuestChats(chats: Chat[]) { localStorage.setItem(CHATS, JSON.stringify(chats)); }
export function clearGuestData() { localStorage.removeItem(MODELS); localStorage.removeItem(CHATS); memoryKeys.clear(); }
