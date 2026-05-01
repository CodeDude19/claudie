export type Role = 'user' | 'assistant';

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
}

export interface Chat {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

const API_KEY_KEY = 'claudie_api_key';
const MODEL_KEY = 'claudie_model';
const CHATS_KEY = 'claudie_chats';
const ACTIVE_CHAT_KEY = 'claudie_active_chat';
const SELECTED_MODELS_KEY = 'claudie_selected_models';
const FONT_SIZE_KEY = 'claudie_font_size';

export const FONT_SIZE_MIN = 13;
export const FONT_SIZE_MAX = 22;
export const FONT_SIZE_DEFAULT = 15.5;

export const MAX_CHATS = 20;

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_KEY);
}

export function saveApiKey(key: string): void {
  localStorage.setItem(API_KEY_KEY, key);
}

export function getDefaultModel(): string | null {
  return localStorage.getItem(MODEL_KEY);
}

export function saveDefaultModel(id: string): void {
  localStorage.setItem(MODEL_KEY, id);
}

export function getChats(): Chat[] {
  const raw = localStorage.getItem(CHATS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Chat[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChats(chats: Chat[]): void {
  // Keep only the most recent MAX_CHATS by updatedAt.
  const trimmed = [...chats]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHATS);
  localStorage.setItem(CHATS_KEY, JSON.stringify(trimmed));
}

export function getActiveChatId(): string | null {
  return localStorage.getItem(ACTIVE_CHAT_KEY);
}

export function setActiveChatId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_CHAT_KEY, id);
  else localStorage.removeItem(ACTIVE_CHAT_KEY);
}

export function createId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getSelectedModelIds(): string[] | null {
  const raw = localStorage.getItem(SELECTED_MODELS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSelectedModelIds(ids: string[]): void {
  localStorage.setItem(SELECTED_MODELS_KEY, JSON.stringify(ids.slice(0, 3)));
}

export function getFontSize(): number {
  const raw = localStorage.getItem(FONT_SIZE_KEY);
  if (!raw) return FONT_SIZE_DEFAULT;
  const n = parseFloat(raw);
  if (!isFinite(n)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));
}

export function saveFontSize(size: number): void {
  localStorage.setItem(FONT_SIZE_KEY, String(size));
}

export function clearAllChats(): void {
  localStorage.removeItem(CHATS_KEY);
  localStorage.removeItem(ACTIVE_CHAT_KEY);
}
