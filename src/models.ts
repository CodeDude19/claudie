export type Family = 'haiku' | 'sonnet' | 'opus' | 'other';

export interface ClaudeModel {
  id: string;
  label: string;       // clean name like "Opus 4.7"
  scope: Scope;        // 'global' | 'us' | 'region' | ''
  family: Family;
  version: number;     // 4.7, 4.5, 3.5, 3, ...  higher = newer
}

export type Scope = 'global' | 'us' | 'region' | '';

export const REGION = 'us-west-2';
export const MAX_SELECTED_MODELS = 3;

// Baked-in fallback used if the control-plane fetch fails.
export const FALLBACK_MODELS: ClaudeModel[] = [
  { id: 'us.anthropic.claude-opus-4-7', label: 'Opus 4.7', scope: 'us', family: 'opus', version: 4.7 },
  { id: 'us.anthropic.claude-sonnet-4-6', label: 'Sonnet 4.6', scope: 'us', family: 'sonnet', version: 4.6 },
  { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Haiku 4.5', scope: 'us', family: 'haiku', version: 4.5 },
];

export const DEFAULT_MODEL_ID = FALLBACK_MODELS[1].id;

function extractFamily(id: string, name: string): Family {
  const s = (id + ' ' + name).toLowerCase();
  if (s.includes('haiku')) return 'haiku';
  if (s.includes('sonnet')) return 'sonnet';
  if (s.includes('opus')) return 'opus';
  return 'other';
}

function extractScope(id: string): Scope {
  if (id.startsWith('global.')) return 'global';
  if (id.startsWith('us.')) return 'us';
  if (/^[a-z]{2,3}(-[a-z]+)+\./.test(id)) return 'region';
  return '';
}

function scopeRank(s: Scope): number {
  return s === 'global' ? 3 : s === 'us' ? 2 : s === 'region' ? 1 : 0;
}

function scopeLabel(s: Scope): string {
  return s === 'global' ? 'global' : s === 'us' ? 'us' : s === 'region' ? 'region' : '';
}

function familyOrder(f: Family): number {
  return f === 'opus' ? 0 : f === 'sonnet' ? 1 : f === 'haiku' ? 2 : 3;
}

// Parse "Opus 4.7" out of ids like "us.anthropic.claude-opus-4-7"
// or "global.anthropic.claude-opus-4-5-20251101-v1:0".
function extractVersion(id: string, family: Family): number {
  if (family === 'other') return 0;
  const m = id.match(new RegExp(`${family}-(\\d+)(?:-(\\d+))?`));
  if (m) {
    const maj = Number(m[1]);
    const min = m[2] ? Number(m[2]) / 10 : 0;
    return maj + min;
  }
  // Older-gen ids like "claude-3-5-haiku" or "claude-3-haiku"
  const m2 = id.match(/claude-(\d+)(?:-(\d+))?-(?:opus|sonnet|haiku)/);
  if (m2) {
    const maj = Number(m2[1]);
    const min = m2[2] ? Number(m2[2]) / 10 : 0;
    return maj + min;
  }
  return 0;
}

// Clean "US Anthropic Claude Opus 4.7" → "Opus 4.7".
function cleanLabel(name: string | undefined, id: string, family: Family, version: number): string {
  if (name) {
    const cleaned = name
      .replace(/^US\s+/i, '')
      .replace(/^GLOBAL\s+/i, '')
      .replace(/^Global\s+/i, '')
      .replace(/^Anthropic\s+/i, '')
      .replace(/^Claude\s+/i, '')
      .replace(/^Cluade\s+/i, '') // AWS typo in their own catalog for Claude 3 Opus
      .trim();
    if (cleaned) return cleaned;
  }
  if (family !== 'other' && version > 0) {
    const cap = family[0].toUpperCase() + family.slice(1);
    // Format X or X.Y
    const maj = Math.floor(version);
    const tenths = Math.round((version - maj) * 10);
    return tenths > 0 ? `${cap} ${maj}.${tenths}` : `${cap} ${maj}`;
  }
  return id;
}

interface ProfileSummary {
  inferenceProfileId?: string;
  inferenceProfileName?: string;
  status?: string;
}

export async function fetchAllClaudeProfiles(apiKey: string): Promise<ClaudeModel[]> {
  const url = `https://bedrock.${REGION}.amazonaws.com/inference-profiles?typeEquals=SYSTEM_DEFINED&maxResults=1000`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) throw new Error(`bedrock list failed: ${resp.status}`);
  const data = (await resp.json()) as { inferenceProfileSummaries?: ProfileSummary[] };
  const profiles = data.inferenceProfileSummaries ?? [];

  const models: ClaudeModel[] = [];
  for (const p of profiles) {
    const id = p.inferenceProfileId;
    if (!id) continue;
    if (!id.includes('anthropic.claude')) continue;
    if (p.status && p.status !== 'ACTIVE') continue;
    const family = extractFamily(id, p.inferenceProfileName ?? '');
    const version = extractVersion(id, family);
    const scope = extractScope(id);
    const label = cleanLabel(p.inferenceProfileName, id, family, version);
    models.push({ id, label, scope, family, version });
  }

  // Family tier → highest version first → preferred scope (global > us > region)
  models.sort((a, b) => {
    const fa = familyOrder(a.family);
    const fb = familyOrder(b.family);
    if (fa !== fb) return fa - fb;
    if (a.version !== b.version) return b.version - a.version;
    return scopeRank(b.scope) - scopeRank(a.scope);
  });

  if (models.length === 0) throw new Error('no claude models returned');
  return models;
}

/** Auto-pick the latest opus/sonnet/haiku (preferring global > us). */
export function autoPickDefaults(all: ClaudeModel[]): ClaudeModel[] {
  const best = new Map<Family, ClaudeModel>();
  for (const m of all) {
    if (m.family === 'other') continue;
    const cur = best.get(m.family);
    if (
      !cur ||
      m.version > cur.version ||
      (m.version === cur.version && scopeRank(m.scope) > scopeRank(cur.scope))
    ) {
      best.set(m.family, m);
    }
  }
  const out: ClaudeModel[] = [];
  for (const family of ['opus', 'sonnet', 'haiku'] as Family[]) {
    const entry = best.get(family);
    if (entry) out.push(entry);
  }
  return out;
}

// Mutable runtime list. Starts as fallback, replaced after a successful fetch.
let currentModels: ClaudeModel[] = [...FALLBACK_MODELS];

export function getModels(): ClaudeModel[] {
  return currentModels;
}

export function setModels(models: ClaudeModel[]): void {
  currentModels = models;
}

export function findModel(id: string): ClaudeModel {
  return currentModels.find((m) => m.id === id) ?? currentModels[0];
}

export { scopeLabel };
