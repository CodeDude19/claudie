import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { streamText } from 'ai';
import type { Message } from './storage';
import { REGION } from './models';

export const DEFAULT_SYSTEM_PROMPT = `You are Claude, a helpful, concise assistant. Answer clearly and directly. Use markdown sparingly — only when it helps readability.`;

let apiKey = '';

export function initClient(key: string): void {
  apiKey = key;
}

export interface StreamCallbacks {
  onDelta: (chunk: string) => void;
  onDone: (fullText: string) => void;
  onError: (err: Error) => void;
}

export interface StreamHandle {
  abort: () => void;
}

export function streamChat(
  modelId: string,
  history: Message[],
  callbacks: StreamCallbacks,
  systemPrompt?: string
): StreamHandle {
  if (!apiKey) {
    callbacks.onError(new Error('API key not set'));
    return { abort: () => {} };
  }

  const controller = new AbortController();
  const system = (systemPrompt && systemPrompt.trim()) || DEFAULT_SYSTEM_PROMPT;

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
      });

      let full = '';
      for await (const delta of result.textStream) {
        full += delta;
        callbacks.onDelta(delta);
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
