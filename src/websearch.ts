import { jsonSchema } from 'ai';

// ── Types ─────────────────────────────────────────────

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  engine: 'startpage';
  results: SearchResult[];
  note?: string;
}

// ── CORS proxy ────────────────────────────────────────
//
// Browser fetch hits Startpage's CORS wall. corsproxy.io is a public,
// zero-auth passthrough that preserves User-Agent and response body.
// If it's ever down, swap the proxy URL — the rest of the scraping
// logic is unchanged.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function viaProxy(url: string): string {
  return `https://corsproxy.io/?${encodeURIComponent(url)}`;
}

async function fetchHTML(url: string): Promise<string> {
  const resp = await fetch(viaProxy(url), {
    headers: { 'User-Agent': UA },
  });
  if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
  return resp.text();
}

function parseDOM(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

// ── Startpage scraper ────────────────────────────────

async function searchStartpage(query: string): Promise<SearchResult[]> {
  const url = `https://www.startpage.com/do/dsearch?query=${encodeURIComponent(query)}&cat=web`;
  const html = await fetchHTML(url);
  const dom = parseDOM(html);

  // Startpage renders `.result` blocks with `h2`, `a.result-title`, and
  // `p.description`. Fall back to alternate selectors in case their DOM
  // changes slightly.
  const blocks = dom.querySelectorAll('.result, .w-gl__result');
  const results: SearchResult[] = [];
  blocks.forEach((node) => {
    const a = node.querySelector<HTMLAnchorElement>('a.result-title, a.w-gl__result-title');
    const h = node.querySelector('h2, h3');
    const desc = node.querySelector('p.description, p.w-gl__description');
    const link = a?.getAttribute('href') || '';
    const title = (h?.textContent || a?.textContent || '').trim();
    const snippet = (desc?.textContent || '').trim();
    if (!link || !title) return;
    results.push({ title, link, snippet });
  });

  return results.slice(0, 8);
}

// ── Page fetch (for a specific URL) ──────────────────

export async function fetchPageText(url: string): Promise<{ url: string; title: string; content: string; truncated: boolean }> {
  const html = await fetchHTML(url);
  const dom = parseDOM(html);
  dom
    .querySelectorAll(
      'script, style, nav, footer, header, aside, [role="navigation"], iframe, svg, noscript'
    )
    .forEach((el) => el.remove());
  const title = dom.querySelector('title')?.textContent?.trim() || '';
  const body = dom.body?.textContent || '';
  const clean = body.replace(/\s+/g, ' ').trim();
  const truncated = clean.length > 8000;
  return { url, title, content: clean.slice(0, 8000), truncated };
}

// ── AI SDK tool definitions ──────────────────────────

const webSearchSchema = jsonSchema({
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'The search query to send to Startpage. Be concise and specific.',
    },
  },
  required: ['query'],
});

const fetchPageSchema = jsonSchema({
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'The full URL to fetch (include https://). Returns cleaned page text.',
    },
  },
  required: ['url'],
});

/**
 * Creates the web_search tool bound to Startpage.
 * Returns an object compatible with Vercel AI SDK's `tools:` option.
 */
export function createWebSearchTool() {
  return {
    type: 'function' as const,
    description:
      'Search the web via Startpage. Returns the top results (title, link, snippet). Use for anything that requires up-to-date or external information.',
    parameters: webSearchSchema,
    inputSchema: webSearchSchema,
    execute: async (input: { query: string }): Promise<SearchResponse> => {
      const query = (input.query || '').trim();
      if (!query) {
        return { query, engine: 'startpage', results: [], note: 'empty query' };
      }
      try {
        const results = await searchStartpage(query);
        return { query, engine: 'startpage', results };
      } catch (err) {
        return {
          query,
          engine: 'startpage',
          results: [],
          note: `search failed: ${(err as Error).message}`,
        };
      }
    },
  };
}

/**
 * Creates the fetch_page tool — lets the model pull the readable text
 * content of a specific URL when it wants to go deeper than the snippet.
 */
export function createFetchPageTool() {
  return {
    type: 'function' as const,
    description:
      'Fetch the readable text content of a web page by URL. Use after web_search if you need the full details of a specific result.',
    parameters: fetchPageSchema,
    inputSchema: fetchPageSchema,
    execute: async (input: { url: string }) => {
      try {
        return await fetchPageText(input.url);
      } catch (err) {
        return { url: input.url, error: (err as Error).message };
      }
    },
  };
}
