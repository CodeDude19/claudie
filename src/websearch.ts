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

// ── Dedupe ───────────────────────────────────────────
function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  for (const r of results) {
    try {
      const u = new URL(r.link);
      const key = u.hostname + u.pathname.replace(/\/$/, '');
      if (!seen.has(key)) seen.set(key, r);
    } catch {
      /* skip malformed URL */
    }
  }
  return Array.from(seen.values());
}

// ── Schemas ──────────────────────────────────────────

const MAX_QUERIES = 5;
const MAX_PAGES = 5;

const webSearchSchema = jsonSchema({
  type: 'object',
  properties: {
    queries: {
      type: 'array',
      items: { type: 'string' },
      description: `An array of 1–${MAX_QUERIES} diverse search queries run in parallel. Vary phrasing and angle for broader coverage.`,
    },
  },
  required: ['queries'],
});

const fetchPageSchema = jsonSchema({
  type: 'object',
  properties: {
    urls: {
      type: 'array',
      items: { type: 'string' },
      description: `1–${MAX_PAGES} fully-qualified URLs (include https://) to fetch in parallel. Returns the cleaned readable text of each.`,
    },
  },
  required: ['urls'],
});

// ── Parallel search tool ─────────────────────────────

export interface ParallelSearchResponse {
  queries: string[];
  engine: 'startpage';
  totalRaw: number;
  uniqueResults: SearchResult[];
  perQuery: Array<{ query: string; count: number }>;
  note?: string;
}

export function createWebSearchTool() {
  return {
    type: 'function' as const,
    description: `Search the web via Startpage. Accepts up to ${MAX_QUERIES} queries and runs them in parallel, then returns deduplicated unique results (title, link, snippet). Use diverse queries to widen coverage. After seeing the results, call fetch_page on the ${MAX_PAGES} most relevant URLs to get full content.`,
    parameters: webSearchSchema,
    inputSchema: webSearchSchema,
    execute: async (input: { queries: string[] }): Promise<ParallelSearchResponse> => {
      const queries = (input.queries || [])
        .map((q) => (q || '').trim())
        .filter(Boolean)
        .slice(0, MAX_QUERIES);

      if (queries.length === 0) {
        return {
          queries: [],
          engine: 'startpage',
          totalRaw: 0,
          uniqueResults: [],
          perQuery: [],
          note: 'empty queries',
        };
      }

      const settled = await Promise.all(
        queries.map((q) => searchStartpage(q).catch(() => [] as SearchResult[]))
      );

      const totalRaw = settled.reduce((sum, arr) => sum + arr.length, 0);
      const uniqueResults = dedupe(settled.flat());
      const perQuery = queries.map((q, i) => ({ query: q, count: settled[i].length }));

      return {
        queries,
        engine: 'startpage',
        totalRaw,
        uniqueResults,
        perQuery,
      };
    },
  };
}

// ── Parallel page-fetch tool ─────────────────────────

export interface ParallelFetchResponse {
  pages: Array<{ url: string; title?: string; content?: string; truncated?: boolean; error?: string }>;
}

export function createFetchPageTool() {
  return {
    type: 'function' as const,
    description: `Fetch the readable text of up to ${MAX_PAGES} URLs in parallel. Use after web_search to read the full content of the most relevant results.`,
    parameters: fetchPageSchema,
    inputSchema: fetchPageSchema,
    execute: async (input: { urls: string[] }): Promise<ParallelFetchResponse> => {
      const urls = (input.urls || [])
        .map((u) => (u || '').trim())
        .filter(Boolean)
        .slice(0, MAX_PAGES);

      const pages = await Promise.all(
        urls.map(async (url) => {
          try {
            const page = await fetchPageText(url);
            return page;
          } catch (err) {
            return { url, error: (err as Error).message };
          }
        })
      );
      return { pages };
    },
  };
}
