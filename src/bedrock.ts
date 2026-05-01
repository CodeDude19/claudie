import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { streamText, stepCountIs } from 'ai';
import type { Message } from './storage';
import { REGION } from './models';
import { createWebSearchTool, createFetchPageTool } from './websearch';

export const DEFAULT_SYSTEM_PROMPT = `You are Claude, a helpful, concise assistant. Answer clearly and directly. Use markdown sparingly — only when it helps readability.`;

let apiKey = '';

export function initClient(key: string): void {
  apiKey = key;
}

export interface StreamCallbacks {
  onDelta: (chunk: string) => void;
  onDone: (fullText: string) => void;
  onError: (err: Error) => void;
  onToolCall?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, result: unknown) => void;
}

export interface StreamHandle {
  abort: () => void;
}

export function streamChat(
  modelId: string,
  history: Message[],
  callbacks: StreamCallbacks,
  systemPrompt?: string,
  opts?: { webSearch?: boolean }
): StreamHandle {
  if (!apiKey) {
    callbacks.onError(new Error('API key not set'));
    return { abort: () => {} };
  }

  const controller = new AbortController();
  let system = (systemPrompt && systemPrompt.trim()) || DEFAULT_SYSTEM_PROMPT;
  if (opts?.webSearch) {
    system +=
      '\n\nYou have access to a `web_search` tool (Startpage) and a `fetch_page` tool. ' +
      'Use them whenever the user asks about current events, live data, or anything ' +
      'that may have changed recently. Cite sources with inline markdown links.';
  }

  const tools = opts?.webSearch
    ? { web_search: createWebSearchTool(), fetch_page: createFetchPageTool() }
    : undefined;

  (async () => {
    try {
      const bedrock = createAmazonBedrock({
        region: REGION,
        apiKey,
      });

      const result = streamText({
        model: bedrock(modelId),
        system,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        abortSignal: controller.signal,
        tools,
        // Allow multi-step tool-calling loops when tools are active.
        stopWhen: tools ? stepCountIs(6) : stepCountIs(1),
      });

      let full = '';
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          const delta = (part as { text?: string; textDelta?: string }).text
            ?? (part as { text?: string; textDelta?: string }).textDelta
            ?? '';
          if (delta) {
            full += delta;
            callbacks.onDelta(delta);
          }
        } else if (part.type === 'tool-call') {
          const p = part as { toolName: string; input: unknown };
          callbacks.onToolCall?.(p.toolName, p.input);
        } else if (part.type === 'tool-result') {
          const p = part as { toolName: string; output: unknown };
          callbacks.onToolResult?.(p.toolName, p.output);
        }
      }
      callbacks.onDone(full);
    } catch (err) {
      if (controller.signal.aborted) return;
      const e = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(e);
    }
  })();

  return { abort: () => controller.abort() };
}

export async function generateTitle(modelId: string, firstMessage: string): Promise<string> {
  if (!apiKey) return firstMessage.slice(0, 40);
  try {
    const bedrock = createAmazonBedrock({ region: REGION, apiKey });
    const result = streamText({
      model: bedrock(modelId),
      system: 'You generate 2-5 word titles for chat conversations. Output only the title, no quotes, no punctuation at the end.',
      messages: [{ role: 'user', content: `Title for this message:\n\n${firstMessage}` }],
    });
    let title = '';
    for await (const delta of result.textStream) title += delta;
    return title.trim().replace(/^["']|["']$/g, '').slice(0, 50) || firstMessage.slice(0, 40);
  } catch {
    return firstMessage.slice(0, 40);
  }
}
