import { marked } from 'marked';
import type { Message } from './storage';

marked.setOptions({
  gfm: true,
  breaks: true,
});

const messagesEl = document.getElementById('messages')!;
const emptyEl = document.getElementById('empty-chat')!;
const chatArea = document.getElementById('chat-area')!;
const errorEl = document.getElementById('error-msg')!;
const sendBtn = document.getElementById('send-btn')!;

let stickToBottom = true;
let editSubmitHandler: ((id: string, newText: string) => void) | null = null;

chatArea.addEventListener('scroll', () => {
  const nearBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 80;
  stickToBottom = nearBottom;
});

export function setEditHandler(fn: (id: string, newText: string) => void): void {
  editSubmitHandler = fn;
}

function scrollToBottom(instant = false): void {
  if (!stickToBottom && !instant) return;
  if (instant) {
    chatArea.scrollTop = chatArea.scrollHeight;
  } else {
    chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
  }
}

/**
 * Aggressively pin to bottom across multiple frames.
 *
 * `content-visibility: auto` + intrinsic-size estimates mean scrollHeight
 * changes as offscreen bubbles render for real. A single scroll at paint
 * time lands on a stale value. We snap on the current frame (for an instant
 * visual baseline), then again after two rAFs (real layout settles), then
 * once more at ~120ms (web fonts / markdown images resolve).
 */
function pinToBottom(): void {
  stickToBottom = true;
  chatArea.scrollTop = chatArea.scrollHeight;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chatArea.scrollTop = chatArea.scrollHeight;
    });
  });
  setTimeout(() => {
    if (stickToBottom) chatArea.scrollTop = chatArea.scrollHeight;
  }, 120);
}

export function setEmptyState(empty: boolean): void {
  if (empty) {
    emptyEl.classList.remove('hidden');
    messagesEl.classList.add('hidden');
  } else {
    emptyEl.classList.add('hidden');
    messagesEl.classList.remove('hidden');
  }
}

function renderMarkdown(text: string): string {
  // marked.parse returns string when given a string, but the typing is loose.
  // Synchronous rendering only — no async tokens used.
  return marked.parse(text, { async: false }) as string;
}

async function copyText(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback: execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
  btn.classList.add('copied');
  const orig = btn.getAttribute('data-label') ?? '';
  btn.setAttribute('aria-label', 'Copied');
  setTimeout(() => {
    btn.classList.remove('copied');
    if (orig) btn.setAttribute('aria-label', orig);
  }, 1400);
}

function makeCopyBtn(getText: () => string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg-action copy-btn';
  btn.setAttribute('aria-label', 'Copy');
  btn.setAttribute('data-label', 'Copy');
  btn.innerHTML = `
    <svg class="icon-copy" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
    <svg class="icon-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyText(getText(), btn);
  });
  return btn;
}

function makeEditBtn(msgId: string, getCurrent: () => string, bubble: HTMLDivElement): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg-action edit-btn';
  btn.setAttribute('aria-label', 'Edit and resend');
  btn.setAttribute('data-label', 'Edit and resend');
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
    </svg>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    startEdit(bubble, msgId, getCurrent());
  });
  return btn;
}

// ── Composer-driven edit mode ──
// Instead of morphing the bubble in place, we lift the prompt into the main
// composer, highlight the bubble, and blur+dim everything else. The composer's
// own send button becomes the "save" action — one input surface, one keyboard.

interface EditSession {
  msgId: string;
  original: string;
  bubble: HTMLDivElement;
  prevComposerValue: string;
}
let activeEdit: EditSession | null = null;

export function getActiveEditId(): string | null {
  return activeEdit?.msgId ?? null;
}

export function isEditing(): boolean {
  return activeEdit !== null;
}

export function cancelEdit(): void {
  if (!activeEdit) return;
  const { bubble, prevComposerValue } = activeEdit;
  bubble.classList.remove('edit-target');
  document.body.classList.remove('editing-mode');
  activeEdit = null;

  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  if (input) {
    input.value = prevComposerValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  }
}

export function submitEdit(newText: string): boolean {
  if (!activeEdit) return false;
  const trimmed = newText.trim();
  if (!trimmed || trimmed === activeEdit.original) {
    cancelEdit();
    return false;
  }
  const { msgId, bubble } = activeEdit;
  bubble.classList.remove('edit-target');
  document.body.classList.remove('editing-mode');
  const msgIdCopy = msgId;
  activeEdit = null;
  if (editSubmitHandler) editSubmitHandler(msgIdCopy, trimmed);
  return true;
}

function startEdit(bubble: HTMLDivElement, msgId: string, current: string): void {
  // If already editing something else, cancel first.
  if (activeEdit) cancelEdit();

  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  if (!input) return;

  activeEdit = {
    msgId,
    original: current,
    bubble,
    prevComposerValue: input.value,
  };

  bubble.classList.add('edit-target');
  document.body.classList.add('editing-mode');

  input.value = current;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // Scroll the bubble into view so user sees which one they're editing.
    bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

export function renderMessages(messages: Message[]): void {
  messagesEl.innerHTML = '';
  for (const m of messages) appendMessage(m);
  pinToBottom();
}

export function appendMessage(msg: Message, streaming = false): void {
  const bubble = document.createElement('div');
  bubble.className = `msg msg-${msg.role} animating`;
  if (streaming) bubble.classList.add('is-streaming');
  bubble.dataset.id = msg.id;

  const content = document.createElement('div');
  content.className = 'msg-content';
  if (streaming && !msg.content) {
    content.classList.add('streaming');
    content.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
  } else if (msg.role === 'assistant') {
    content.innerHTML = renderMarkdown(msg.content);
  } else {
    content.textContent = msg.content;
  }
  bubble.appendChild(content);

  // Actions — only once actual content exists (not the typing placeholder).
  if (!(streaming && !msg.content)) {
    bubble.appendChild(buildActions(msg, bubble));
  }

  messagesEl.appendChild(bubble);

  // Kick off entry animation on the next frame, then drop will-change once done.
  requestAnimationFrame(() => {
    bubble.classList.add('enter');
    bubble.addEventListener(
      'transitionend',
      () => bubble.classList.remove('animating'),
      { once: true }
    );
  });
  stickToBottom = true;
  requestAnimationFrame(() => scrollToBottom());
}

function buildActions(msg: Message, bubble: HTMLDivElement): HTMLDivElement {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  // Anchor getCurrent to the bubble's dataset so edit reads the latest value.
  bubble.dataset.text = msg.content;
  const getText = () => bubble.dataset.text ?? '';
  actions.appendChild(makeCopyBtn(getText));
  if (msg.role === 'user') {
    actions.appendChild(makeEditBtn(msg.id, getText, bubble));
  }
  return actions;
}

// ── Stream batcher ──
// Coalesce per-token deltas into one render per frame. Big perf win on long
// replies — at 120Hz we render at 120Hz, not per-token (easily 300+/s).
interface StreamState {
  latestText: string;
  rafId: number;
  done: boolean;
  id: string;
}
const streamStates = new Map<string, StreamState>();

function flushStream(state: StreamState): void {
  state.rafId = 0;
  const bubble = messagesEl.querySelector<HTMLDivElement>(`.msg[data-id="${state.id}"]`);
  if (!bubble) return;
  const content = bubble.querySelector<HTMLDivElement>('.msg-content')!;
  if (content.classList.contains('streaming')) content.classList.remove('streaming');
  content.innerHTML = renderMarkdown(state.latestText);
  bubble.dataset.text = state.latestText;
  if (state.done) {
    content.classList.add('done');
    bubble.classList.remove('is-streaming');
    if (!bubble.querySelector('.msg-actions')) {
      const stub: Message = { id: state.id, role: 'assistant', content: state.latestText, createdAt: 0 };
      bubble.appendChild(buildActions(stub, bubble));
    }
    streamStates.delete(state.id);
    // Final scroll after the answer is done. If the user is roughly near the
    // bottom (within ~300px), pin them there — this guards against the case
    // where late layout shifts (code blocks, tables, msg-actions appearing)
    // bumped scrollHeight and the last scroll in-flight missed the mark.
    const gap = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    if (gap < 300) pinToBottom();
  } else {
    scrollToBottom();
  }
}

export function updateAssistantStream(id: string, text: string, done = false): void {
  const bubble = messagesEl.querySelector<HTMLDivElement>(`.msg[data-id="${id}"]`);
  if (!bubble) return;

  let state = streamStates.get(id);
  if (!state) {
    state = { latestText: text, rafId: 0, done: false, id };
    streamStates.set(id, state);
  } else {
    state.latestText = text;
  }
  if (done) state.done = true;

  if (done) {
    // Flush immediately — ensures final render + actions show up without delay.
    if (state.rafId) cancelAnimationFrame(state.rafId);
    flushStream(state);
    return;
  }

  if (state.rafId) return; // render already queued this frame
  state.rafId = requestAnimationFrame(() => flushStream(state!));
}

export function updateAssistantToolStatus(id: string, label: string): void {
  const bubble = messagesEl.querySelector<HTMLDivElement>(`.msg[data-id="${id}"]`);
  if (!bubble) return;
  let status = bubble.querySelector<HTMLDivElement>('.tool-status');
  if (!status) {
    status = document.createElement('div');
    status.className = 'tool-status';
    status.innerHTML = '<span class="tool-status-spinner"></span><span class="tool-status-text"></span>';
    const content = bubble.querySelector<HTMLDivElement>('.msg-content');
    bubble.insertBefore(status, content);
  }
  const text = status.querySelector<HTMLSpanElement>('.tool-status-text');
  if (text) text.textContent = label;
}

export function clearAssistantToolStatus(id: string): void {
  const bubble = messagesEl.querySelector<HTMLDivElement>(`.msg[data-id="${id}"]`);
  const status = bubble?.querySelector('.tool-status');
  if (status) status.remove();
}

export function showError(text: string): void {
  errorEl.textContent = text;
  errorEl.classList.remove('hidden');
}

export function hideError(): void {
  errorEl.classList.add('hidden');
  errorEl.textContent = '';
}

export function setSending(sending: boolean): void {
  if (sending) {
    sendBtn.classList.add('sending');
    sendBtn.setAttribute('aria-label', 'Stop');
  } else {
    sendBtn.classList.remove('sending');
    sendBtn.setAttribute('aria-label', 'Send');
  }
}

// ── Font size ──

export function applyFontSize(size: number): void {
  document.documentElement.style.setProperty('--msg-font-size', `${size}px`);
}

// ── Confirm dialog ──

const confirmOverlay = document.getElementById('confirm-overlay')!;
const confirmTitleEl = document.getElementById('confirm-title')!;
const confirmMsgEl = document.getElementById('confirm-message')!;
const confirmOkBtn = document.getElementById('confirm-ok') as HTMLButtonElement;
const confirmCancelBtn = document.getElementById('confirm-cancel') as HTMLButtonElement;

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function confirmDialog(opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    confirmTitleEl.textContent = opts.title ?? 'Are you sure?';
    confirmMsgEl.textContent = opts.message ?? '';
    confirmOkBtn.textContent = opts.confirmLabel ?? 'Delete';
    confirmOkBtn.classList.toggle('btn-danger-solid', opts.danger !== false);
    confirmOkBtn.classList.toggle('btn-primary', opts.danger === false);

    confirmOverlay.classList.remove('hidden');
    confirmOverlay.removeAttribute('inert');
    requestAnimationFrame(() => confirmOverlay.classList.add('open'));

    const close = (result: boolean): void => {
      confirmOverlay.classList.remove('open');
      if (confirmOverlay.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
      confirmOverlay.setAttribute('inert', '');
      setTimeout(() => confirmOverlay.classList.add('hidden'), 200);
      confirmOkBtn.removeEventListener('click', onOk);
      confirmCancelBtn.removeEventListener('click', onCancel);
      confirmOverlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk = () => close(true);
    const onCancel = () => close(false);
    const onBackdrop = (e: Event) => {
      if (e.target === confirmOverlay) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };

    confirmOkBtn.addEventListener('click', onOk);
    confirmCancelBtn.addEventListener('click', onCancel);
    confirmOverlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => confirmOkBtn.focus());
  });
}
