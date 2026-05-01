import {
  getApiKey,
  saveApiKey,
  getDefaultModel,
  saveDefaultModel,
  getChats,
  saveChats,
  getActiveChatId,
  setActiveChatId,
  getSelectedModelIds,
  saveSelectedModelIds,
  getFontSize,
  saveFontSize,
  clearAllChats,
  FONT_SIZE_DEFAULT,
  createId,
  type Chat,
  type Message,
} from './storage';
import {
  getModels,
  setModels,
  DEFAULT_MODEL_ID,
  MAX_SELECTED_MODELS,
  FALLBACK_MODELS,
  findModel,
  fetchAllClaudeProfiles,
  autoPickDefaults,
  type ClaudeModel,
} from './models';
import { initClient, streamChat, generateTitle, type StreamHandle } from './bedrock';
import {
  renderMessages,
  appendMessage,
  updateAssistantStream,
  setEmptyState,
  showError,
  hideError,
  setSending,
  applyFontSize,
  confirmDialog,
  setEditHandler,
  isEditing,
  submitEdit,
  cancelEdit,
  getActiveEditId,
} from './ui';
import './style.css';

// ── DOM ──
const credOverlay = document.getElementById('cred-overlay')!;
const app = document.getElementById('app')!;
const saveCredsBtn = document.getElementById('save-creds')!;
const closeCredsBtn = document.getElementById('close-creds')!;
const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const modelsCountEl = document.getElementById('models-count')!;
const modelsStatusEl = document.getElementById('models-status')!;
const modelsChecklistEl = document.getElementById('models-checklist')!;
const refreshModelsBtn = document.getElementById('refresh-models')!;
const fontSizeRange = document.getElementById('font-size-range') as HTMLInputElement;
const fontSizePreview = document.getElementById('font-size-preview')!;
const deleteAllBtn = document.getElementById('delete-all-btn')!;
const editChip = document.getElementById('edit-chip')!;
const editCancelBtn = document.getElementById('edit-cancel')!;
const editBackdrop = document.getElementById('edit-backdrop')!;
const sendBtnEl = document.getElementById('send-btn') as HTMLButtonElement;

const menuBtn = document.getElementById('menu-btn')!;
const newChatBtn = document.getElementById('new-chat-btn')!;
const modelBtn = document.getElementById('model-btn')!;
const modelLabel = document.getElementById('model-label')!;

const drawer = document.getElementById('drawer')!;
const drawerClose = document.getElementById('drawer-close')!;
const drawerNew = document.getElementById('drawer-new')!;
const chatList = document.getElementById('chat-list')!;
const chatListEmpty = document.getElementById('chat-list-empty')!;
const settingsBtn = document.getElementById('settings-btn')!;

const modelSheet = document.getElementById('model-sheet')!;
const modelListEl = document.getElementById('model-list')!;

const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;

// ── State ──
let chats: Chat[] = [];
let activeChatId: string | null = null;
let currentModelId: string = DEFAULT_MODEL_ID;
let currentStream: StreamHandle | null = null;
let isStreaming = false;

// Settings-modal state: the catalog of profiles fetched from Bedrock.
let allProfiles: ClaudeModel[] = [];
// Working selection while the settings modal is open — saved on Connect.
let draftSelection: string[] = [];

// ── Helpers ──
function getActiveChat(): Chat | null {
  if (!activeChatId) return null;
  return chats.find((c) => c.id === activeChatId) ?? null;
}

function persist(): void {
  saveChats(chats);
  // Refresh in-memory list from storage to keep 20-cap consistent.
  chats = getChats();
  // Drop active if it was trimmed off.
  if (activeChatId && !chats.find((c) => c.id === activeChatId)) {
    activeChatId = chats[0]?.id ?? null;
    setActiveChatId(activeChatId);
  }
}

function setModel(id: string): void {
  currentModelId = id;
  saveDefaultModel(id);
  modelLabel.textContent = findModel(id).label;
  const active = getActiveChat();
  if (active) {
    active.model = id;
    persist();
  }
}

function openDrawer(): void {
  renderChatList();
  drawer.classList.remove('hidden');
  drawer.removeAttribute('inert');
  requestAnimationFrame(() => drawer.classList.add('open'));
}

function closeDrawer(): void {
  // Move focus out before hiding so we don't trap focus in an inert subtree.
  if (drawer.contains(document.activeElement)) {
    (document.activeElement as HTMLElement).blur();
  }
  drawer.classList.remove('open');
  drawer.setAttribute('inert', '');
  setTimeout(() => drawer.classList.add('hidden'), 280);
}

function openModelSheet(): void {
  renderModelList();
  modelSheet.classList.remove('hidden');
  modelSheet.removeAttribute('inert');
  requestAnimationFrame(() => modelSheet.classList.add('open'));
}

function closeModelSheet(): void {
  if (modelSheet.contains(document.activeElement)) {
    (document.activeElement as HTMLElement).blur();
  }
  modelSheet.classList.remove('open');
  modelSheet.setAttribute('inert', '');
  setTimeout(() => modelSheet.classList.add('hidden'), 280);
}

// ── Rendering ──
function renderChatList(): void {
  chatList.innerHTML = '';
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  if (sorted.length === 0) {
    chatListEmpty.classList.remove('hidden');
    return;
  }
  chatListEmpty.classList.add('hidden');
  for (const chat of sorted) {
    const li = document.createElement('li');
    li.className = 'chat-item' + (chat.id === activeChatId ? ' active' : '');

    const btn = document.createElement('button');
    btn.className = 'chat-item-btn';
    btn.type = 'button';

    const title = document.createElement('span');
    title.className = 'chat-item-title';
    title.textContent = chat.title || 'New chat';

    const meta = document.createElement('span');
    meta.className = 'chat-item-meta';
    meta.textContent = formatRelativeTime(chat.updatedAt);

    btn.appendChild(title);
    btn.appendChild(meta);
    btn.addEventListener('click', () => {
      selectChat(chat.id);
      closeDrawer();
    });

    const del = document.createElement('button');
    del.className = 'chat-item-del';
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete chat');
    del.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    });

    li.appendChild(btn);
    li.appendChild(del);
    chatList.appendChild(li);
  }
}

function familyTagline(family: string): string {
  if (family === 'opus') return 'Most capable';
  if (family === 'sonnet') return 'Balanced';
  if (family === 'haiku') return 'Fastest';
  return '';
}

function renderModelList(): void {
  modelListEl.innerHTML = '';
  for (const m of getModels()) {
    const li = document.createElement('li');
    li.className = 'model-item' + (m.id === currentModelId ? ' active' : '');
    const scopeChip = m.scope ? `<span class="scope-chip scope-${m.scope}">${m.scope}</span>` : '';
    li.innerHTML = `
      <div class="model-item-main">
        <span class="model-item-label">${m.label}${scopeChip}</span>
        <span class="model-item-tag">${familyTagline(m.family)}</span>
      </div>
      <svg class="model-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    `;
    li.addEventListener('click', () => {
      setModel(m.id);
      closeModelSheet();
    });
    modelListEl.appendChild(li);
  }
}

function applySelectedModels(ids: string[]): void {
  // Build the runtime list from allProfiles in order; if a saved id isn't in
  // the catalog (e.g. we haven't fetched yet), fall back to the fallback entry.
  const selected: ClaudeModel[] = [];
  for (const id of ids) {
    const fromCatalog = allProfiles.find((m) => m.id === id);
    if (fromCatalog) {
      selected.push(fromCatalog);
      continue;
    }
    const fromFallback = FALLBACK_MODELS.find((m) => m.id === id);
    if (fromFallback) selected.push(fromFallback);
  }
  if (selected.length === 0) return;
  setModels(selected);
  if (!selected.find((m) => m.id === currentModelId)) {
    setModel(selected[0].id);
  } else {
    modelLabel.textContent = findModel(currentModelId).label;
  }
  if (!modelSheet.classList.contains('hidden')) renderModelList();
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Chat actions ──
function newChat(): void {
  // If current active chat is empty, reuse it.
  const active = getActiveChat();
  if (active && active.messages.length === 0) {
    renderActive();
    return;
  }
  const now = Date.now();
  const chat: Chat = {
    id: createId(),
    title: '',
    model: currentModelId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  chats.unshift(chat);
  activeChatId = chat.id;
  setActiveChatId(chat.id);
  persist();
  renderActive();
}

function selectChat(id: string): void {
  activeChatId = id;
  setActiveChatId(id);
  const chat = getActiveChat();
  if (chat) {
    currentModelId = chat.model;
    modelLabel.textContent = findModel(chat.model).label;
  }
  renderActive();
}

async function deleteChat(id: string): Promise<void> {
  const chat = chats.find((c) => c.id === id);
  const title = chat?.title || 'this chat';
  const ok = await confirmDialog({
    title: 'Delete chat?',
    message: `"${title}" will be permanently removed. This can't be undone.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  chats = chats.filter((c) => c.id !== id);
  if (activeChatId === id) {
    activeChatId = chats[0]?.id ?? null;
    setActiveChatId(activeChatId);
  }
  persist();
  renderChatList();
  renderActive();
}

async function deleteAllChats(): Promise<void> {
  if (chats.length === 0) return;
  const ok = await confirmDialog({
    title: 'Delete all chats?',
    message: `All ${chats.length} chat${chats.length === 1 ? '' : 's'} will be permanently removed. This can't be undone.`,
    confirmLabel: 'Delete all',
  });
  if (!ok) return;
  clearAllChats();
  chats = [];
  activeChatId = null;
  renderChatList();
  renderActive();
}

async function editAndResend(msgId: string, newText: string): Promise<void> {
  const chat = getActiveChat();
  if (!chat) return;
  const idx = chat.messages.findIndex((m) => m.id === msgId);
  if (idx < 0) return;
  if (chat.messages[idx].role !== 'user') return;

  // If a stream is running, abort it first so we don't race.
  if (isStreaming) abortStream();

  // Truncate to (but not including) the edited message, then resend.
  chat.messages = chat.messages.slice(0, idx);
  chat.updatedAt = Date.now();
  renderActive();
  persist();

  // Re-submit the edited text through the normal send path.
  chatInput.value = newText;
  autoGrow();
  await handleSend();
}

function renderActive(): void {
  const chat = getActiveChat();
  if (!chat || chat.messages.length === 0) {
    setEmptyState(true);
    renderMessages([]);
    return;
  }
  setEmptyState(false);
  renderMessages(chat.messages);
}

// ── Send ──
async function handleSend(): Promise<void> {
  const text = chatInput.value.trim();
  if (!text || isStreaming) return;

  hideError();

  // Ensure there's an active chat.
  let chat = getActiveChat();
  if (!chat) {
    newChat();
    chat = getActiveChat();
    if (!chat) return;
  }

  const userMsg: Message = {
    id: createId(),
    role: 'user',
    content: text,
    createdAt: Date.now(),
  };
  chat.messages.push(userMsg);
  chat.updatedAt = Date.now();

  chatInput.value = '';
  autoGrow();

  setEmptyState(false);
  appendMessage(userMsg);

  // Placeholder assistant message.
  const assistantMsg: Message = {
    id: createId(),
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
  };
  chat.messages.push(assistantMsg);
  appendMessage(assistantMsg, true);

  isStreaming = true;
  setSending(true);

  // Kick off title generation in background after first user message.
  const isFirstMessage = chat.messages.filter((m) => m.role === 'user').length === 1;

  // Snapshot history up to (but not including) the empty assistant placeholder.
  // Also drop any empty-content messages from prior aborted/failed streams —
  // Bedrock rejects requests with empty ContentBlocks.
  const history = chat.messages.slice(0, -1).filter((m) => m.content.trim().length > 0);

  currentStream = streamChat(chat.model, history, {
    onDelta: (delta) => {
      assistantMsg.content += delta;
      updateAssistantStream(assistantMsg.id, assistantMsg.content);
    },
    onDone: (full) => {
      assistantMsg.content = full;
      updateAssistantStream(assistantMsg.id, full, true);
      chat!.updatedAt = Date.now();
      persist();
      isStreaming = false;
      setSending(false);
      currentStream = null;
    },
    onError: (err) => {
      if (!assistantMsg.content) {
        // Remove empty assistant bubble on error.
        chat!.messages.pop();
      }
      updateAssistantStream(assistantMsg.id, assistantMsg.content || '', true);
      renderActive();
      showError(err.message || 'Something went wrong.');
      persist();
      isStreaming = false;
      setSending(false);
      currentStream = null;
    },
  });

  if (isFirstMessage) {
    generateTitle(chat.model, text).then((title) => {
      const c = chats.find((x) => x.id === chat!.id);
      if (c && !c.title) {
        c.title = title;
        persist();
      }
    });
  }
}

function abortStream(): void {
  if (currentStream) {
    currentStream.abort();
    currentStream = null;
  }
  // Drop any trailing empty assistant placeholder so it doesn't pollute history.
  const chat = getActiveChat();
  if (chat) {
    const last = chat.messages[chat.messages.length - 1];
    if (last && last.role === 'assistant' && !last.content.trim()) {
      chat.messages.pop();
      renderActive();
    }
  }
  isStreaming = false;
  setSending(false);
  persist();
}

// ── Textarea auto-grow ──
function autoGrow(): void {
  chatInput.style.height = 'auto';
  const max = 160;
  chatInput.style.height = Math.min(chatInput.scrollHeight, max) + 'px';
}

chatInput.addEventListener('input', autoGrow);

// Tap-outside-to-dismiss: blur the composer (and close the iOS keyboard) when
// the user taps anywhere that isn't the composer itself.
document.addEventListener('pointerdown', (e) => {
  if (document.activeElement !== chatInput) return;
  const target = e.target as Node | null;
  if (!target) return;
  // Let presses on the composer / send button / edit chip keep focus.
  if (chatForm.contains(target)) return;
  const chip = document.getElementById('edit-chip');
  if (chip && chip.contains(target)) return;
  chatInput.blur();
});

// Drive the keyboard slide directly off focus state. Blur commits 0 before
// visualViewport notices, so the composer starts descending on the same frame
// the user pressed Enter / tapped away — no perceptible stop-and-drop.
chatInput.addEventListener('blur', () => keyboard.commit(0));
chatInput.addEventListener('focus', () => keyboard.refresh());
chatInput.addEventListener('keydown', (e) => {
  // Desktop shortcut — Enter sends, Shift+Enter newline. On mobile (no physical keyboard), this is a noop.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    // Only treat as send on non-touch devices to avoid surprising mobile users.
    const isTouch = matchMedia('(pointer: coarse)').matches;
    if (!isTouch) {
      e.preventDefault();
      handleSend();
    }
  }
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (isEditing()) {
    const ok = submitEdit(chatInput.value);
    if (!ok) syncEditUI();
    return;
  }
  if (isStreaming) {
    abortStream();
    return;
  }
  handleSend();
});

function setModelsStatus(text: string, show: boolean): void {
  modelsStatusEl.textContent = text;
  modelsStatusEl.classList.toggle('hidden', !show);
  modelsChecklistEl.classList.toggle('hidden', show);
}

function updateModelsCount(): void {
  modelsCountEl.textContent = `${draftSelection.length}/${MAX_SELECTED_MODELS}`;
}

function renderModelsChecklist(): void {
  modelsChecklistEl.innerHTML = '';
  if (allProfiles.length === 0) {
    modelsChecklistEl.classList.add('hidden');
    return;
  }
  modelsChecklistEl.classList.remove('hidden');

  // Group by family for readability.
  const families: Array<{ key: string; label: string }> = [
    { key: 'opus', label: 'Opus' },
    { key: 'sonnet', label: 'Sonnet' },
    { key: 'haiku', label: 'Haiku' },
    { key: 'other', label: 'Other' },
  ];

  for (const fam of families) {
    const items = allProfiles.filter((m) => m.family === fam.key);
    if (items.length === 0) continue;

    const header = document.createElement('li');
    header.className = 'models-group-header';
    header.textContent = fam.label;
    modelsChecklistEl.appendChild(header);

    for (const m of items) {
      const li = document.createElement('li');
      li.className = 'models-row';

      const checked = draftSelection.includes(m.id);
      const atLimit = draftSelection.length >= MAX_SELECTED_MODELS && !checked;

      const label = document.createElement('label');
      label.className = 'models-check' + (checked ? ' checked' : '') + (atLimit ? ' disabled' : '');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      cb.disabled = atLimit;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (draftSelection.length >= MAX_SELECTED_MODELS) {
            cb.checked = false;
            return;
          }
          draftSelection.push(m.id);
        } else {
          draftSelection = draftSelection.filter((id) => id !== m.id);
        }
        updateModelsCount();
        renderModelsChecklist();
      });

      const box = document.createElement('span');
      box.className = 'models-box';
      box.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

      const text = document.createElement('span');
      text.className = 'models-row-text';

      const main = document.createElement('span');
      main.className = 'models-row-label';
      main.textContent = m.label;
      if (m.scope) {
        const chip = document.createElement('span');
        chip.className = `scope-chip scope-${m.scope}`;
        chip.textContent = m.scope;
        main.appendChild(chip);
      }

      const sub = document.createElement('span');
      sub.className = 'models-row-id';
      sub.textContent = m.id;

      text.appendChild(main);
      text.appendChild(sub);

      label.appendChild(cb);
      label.appendChild(box);
      label.appendChild(text);
      li.appendChild(label);
      modelsChecklistEl.appendChild(li);
    }
  }
}

async function loadProfilesForSettings(apiKey: string): Promise<void> {
  setModelsStatus('Loading models…', true);
  try {
    allProfiles = await fetchAllClaudeProfiles(apiKey);
    if (draftSelection.length === 0) {
      // First time / no stored selection: auto-pick latest opus/sonnet/haiku.
      draftSelection = autoPickDefaults(allProfiles).map((m) => m.id);
    } else {
      // Drop any saved ids no longer in the catalog.
      draftSelection = draftSelection.filter((id) => allProfiles.some((m) => m.id === id));
    }
    updateModelsCount();
    renderModelsChecklist();
    setModelsStatus('', false);
  } catch (err) {
    console.warn('[claudie] profile fetch failed:', err);
    setModelsStatus('Could not load models. Check your key and try Refresh.', true);
  }
}

function showSetup(): void {
  credOverlay.classList.remove('hidden');
  app.classList.add('hidden');
  const key = getApiKey();
  if (key) apiKeyInput.value = key;

  // Seed font size controls from storage.
  const size = getFontSize();
  fontSizeRange.value = String(size);
  fontSizePreview.textContent = `${size}px`;

  // Hydrate draft selection from storage (or fall back to current runtime list).
  draftSelection = (getSelectedModelIds() ?? getModels().map((m) => m.id)).slice(0, MAX_SELECTED_MODELS);
  updateModelsCount();

  if (allProfiles.length > 0) {
    renderModelsChecklist();
    setModelsStatus('', false);
  } else if (key) {
    loadProfilesForSettings(key);
  } else {
    setModelsStatus('Enter your key to load models.', true);
  }
}

function showApp(): void {
  credOverlay.classList.add('hidden');
  app.classList.remove('hidden');
  modelLabel.textContent = findModel(currentModelId).label;
  renderActive();
}

saveCredsBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  saveApiKey(key);
  initClient(key);
  if (draftSelection.length > 0) {
    saveSelectedModelIds(draftSelection);
    applySelectedModels(draftSelection);
  }
  showApp();
});

apiKeyInput.addEventListener('change', () => {
  const key = apiKeyInput.value.trim();
  if (key) loadProfilesForSettings(key);
});

refreshModelsBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim() || getApiKey();
  if (!key) {
    setModelsStatus('Enter your key first.', true);
    return;
  }
  loadProfilesForSettings(key);
});

closeCredsBtn.addEventListener('click', () => {
  if (getApiKey()) {
    credOverlay.classList.add('hidden');
    app.classList.remove('hidden');
  }
});

// ── Wiring ──
menuBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
drawer.querySelector('.drawer-backdrop')!.addEventListener('click', closeDrawer);
drawerNew.addEventListener('click', () => {
  newChat();
  closeDrawer();
});
newChatBtn.addEventListener('click', () => newChat());

modelBtn.addEventListener('click', openModelSheet);
modelSheet.querySelector('.sheet-backdrop')!.addEventListener('click', closeModelSheet);

settingsBtn.addEventListener('click', () => {
  closeDrawer();
  showSetup();
});

// Font size
fontSizeRange.addEventListener('input', () => {
  const size = parseFloat(fontSizeRange.value);
  applyFontSize(size);
  fontSizePreview.textContent = `${size}px`;
  saveFontSize(size);
});

// Delete all chats
deleteAllBtn.addEventListener('click', () => {
  deleteAllChats();
});

// Edit-and-resend wiring for user messages.
setEditHandler((id, text) => {
  syncEditUI();
  editAndResend(id, text);
});

function syncEditUI(): void {
  const editing = isEditing();
  document.body.classList.toggle('editing-mode', editing);
  editChip.classList.toggle('hidden', !editing);
  editBackdrop.classList.toggle('hidden', !editing);
  sendBtnEl.classList.toggle('editing', editing);
  chatInput.placeholder = editing ? 'Edit your message…' : 'Message Claude...';
  autoGrow();
  if (editing) {
    // Scroll the bubble being edited into view as a gentle confirmation.
    const id = getActiveEditId();
    if (id) {
      const bubble = document.querySelector(`.msg[data-id="${id}"]`);
      if (bubble) bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

// Re-sync whenever the ui module flips edit state on its own (e.g. startEdit).
// We use a MutationObserver on body.class because the ui module toggles it.
new MutationObserver(() => {
  const editing = document.body.classList.contains('editing-mode');
  editChip.classList.toggle('hidden', !editing);
  editBackdrop.classList.toggle('hidden', !editing);
  sendBtnEl.classList.toggle('editing', editing);
  chatInput.placeholder = editing ? 'Edit your message…' : 'Message Claude...';
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

editCancelBtn.addEventListener('click', () => {
  cancelEdit();
  syncEditUI();
  chatInput.blur();
});
editBackdrop.addEventListener('click', () => {
  cancelEdit();
  syncEditUI();
  chatInput.blur();
});

// Esc anywhere cancels an in-progress edit.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isEditing()) {
    e.preventDefault();
    cancelEdit();
    syncEditUI();
  }
});

// ── Service worker ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/claudie/sw.js').catch(() => {});
}

// ── Keyboard inset controller ──
// Expose one CSS variable (`--kb-h`) representing the keyboard's intrusion
// into the viewport. The composer lifts by this amount via transform; the
// chat area pads by it. Transforms are GPU-composited — no layout on every
// visualViewport tick.
//
// Design notes:
//   • rAF-coalesce updates. Safari emits `visualViewport.resize` during scroll
//     too; without batching we'd thrash.
//   • Optimistic commit on blur. `--kb-h := 0` on blur starts the slide
//     immediately rather than waiting for Safari's lazy end-of-animation event.
//   • Anchor to layout viewport, not visual. The app is `position: fixed;
//     inset: 0`, so visualViewport.offsetTop isn't relevant here.
const root = document.documentElement;

const keyboard = (() => {
  let currentKb = 0;
  let rafId = 0;
  let optimistic = false; // set true while we've committed a value ahead of vv

  const commit = (kb: number): void => {
    if (kb === currentKb) return;
    currentKb = kb;
    root.style.setProperty('--kb-h', `${kb}px`);
  };

  const measure = (): number => {
    const vv = window.visualViewport;
    if (!vv) return 0;
    // Keyboard = layout height - visual height - offsetTop. Clamp to avoid
    // negative values from sub-pixel rounding during scroll inertia.
    const kb = window.innerHeight - vv.height - vv.offsetTop;
    return Math.max(0, Math.round(kb));
  };

  const schedule = (): void => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      // If we committed an optimistic value, only let a larger real value win
      // (i.e. keyboard still opening). Smaller values during close are the
      // animation we're already running — ignore them to prevent jitter.
      const next = measure();
      if (optimistic && next < currentKb) return;
      optimistic = false;
      commit(next);
    });
  };

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', () => setTimeout(schedule, 120));

  return {
    /** Commit a value ahead of visualViewport (e.g. on blur, set 0). */
    commit(kb: number): void {
      optimistic = true;
      commit(kb);
    },
    refresh: schedule,
  };
})();

// iOS occasionally scrolls the document when focusing an input even with
// position: fixed. Snap it back — the app is pinned anyway.
window.addEventListener(
  'scroll',
  () => {
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  },
  { passive: true }
);

// Prevent double-tap zoom on iOS for interactive controls (touch-action: manipulation
// handles most of this, but belt + suspenders for older iOS).
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ── Init ──
chats = getChats();
activeChatId = getActiveChatId();
currentModelId = getDefaultModel() ?? DEFAULT_MODEL_ID;

if (activeChatId && !chats.find((c) => c.id === activeChatId)) {
  activeChatId = null;
}

// Apply stored font size immediately.
applyFontSize(getFontSize() || FONT_SIZE_DEFAULT);

// Hydrate selected models from storage, falling back to the baked-in defaults.
const savedSelection = getSelectedModelIds();
if (savedSelection && savedSelection.length > 0) {
  applySelectedModels(savedSelection);
}

const apiKey = getApiKey();
if (apiKey) {
  initClient(apiKey);
  showApp();
  // Warm the profile catalog so the settings modal opens instantly next time,
  // and so labels refresh if the user's picks exist in the fresh list.
  fetchAllClaudeProfiles(apiKey)
    .then((profiles) => {
      allProfiles = profiles;
      const stored = getSelectedModelIds();
      if (stored && stored.length > 0) applySelectedModels(stored);
    })
    .catch((err) => console.warn('[claudie] profile warmup failed:', err));
} else {
  showSetup();
}
