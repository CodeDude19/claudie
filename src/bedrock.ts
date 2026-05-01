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
    system += `

You are in **web research mode**. Your job is to ground answers in fresh, reliable information from the live web.

## How to research

1. **Plan first.** Read the user's question and identify 3–5 distinct angles / sub-questions worth searching. Different phrasings and angles surface different sources.
2. **Batch your searches.** Call \`web_search\` **once** with up to 5 diverse queries in the \`queries\` array — they run in parallel. Do NOT call \`web_search\` multiple times if a single batched call will do.
3. **Read deeply.** From the returned results, pick the 3–5 most promising, authoritative URLs and call \`fetch_page\` **once** with up to 5 URLs in the \`urls\` array — they fetch in parallel. Snippets alone are rarely enough; always read the pages unless the snippets definitively answer the question.
4. **Synthesise, don't transcribe.** Compose a clear answer in your own words, combining evidence from multiple pages. Prefer primary sources and recent ones.
5. **Cite inline.** For every non-trivial claim, include an inline markdown link to the source: \`[short anchor text](https://url)\`. Don't dump a big "sources" list at the end — weave citations into the prose.

## Rules

- Minimum effort: one \`web_search\` call with multiple queries, then one \`fetch_page\` call with multiple URLs. Aim for exactly this pattern before answering.
- Don't re-search the same thing with slightly different wording — diversify.
- If search or fetch fails, note that and answer with what you have.
- If the question is purely conversational or doesn't benefit from the web, skip the tools and answer directly.`;
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
        stopWhen: tools ? stepCountIs(8) : stepCountIs(1),
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
