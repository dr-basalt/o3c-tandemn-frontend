import { Model } from '@/mock/types';

// Greffon LiteLLM : construit la liste de modèles depuis la gateway O3C
// (OpenAI-compatible GET /models) au lieu des mocks. Cache court en mémoire.
let cache: { at: number; models: Model[] } | null = null;
const TTL = 60_000;

function meta(id: string): { vendor: string; series: string; ctx: number; modalities: Model['modalities'] } {
  const l = id.toLowerCase();
  if (l.startsWith('claude')) return { vendor: 'Anthropic', series: 'Claude', ctx: 200000, modalities: ['text', 'image'] };
  if (l.startsWith('gpt') || l.startsWith('o1') || l.startsWith('o3') || l.includes('codex') || l.includes('realtime'))
    return { vendor: 'OpenAI', series: 'GPT', ctx: 128000, modalities: ['text', 'image'] };
  if (l.startsWith('llm-o3c') || l.startsWith('o3c')) return { vendor: 'O3C', series: 'O3C', ctx: 128000, modalities: ['text'] };
  if (l.includes('deepseek')) return { vendor: 'DeepSeek', series: 'DeepSeek', ctx: 128000, modalities: ['text'] };
  if (l.includes('qwen')) return { vendor: 'Qwen', series: 'Qwen', ctx: 32768, modalities: ['text'] };
  return { vendor: id.split(/[/-]/)[0] || 'llm', series: 'Other', ctx: 32768, modalities: ['text'] };
}

function toModel(id: string, i: number): Model {
  const m = meta(id);
  const name = id.replace(/[-_/]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return {
    id, vendor: m.vendor, series: m.series as any, name, short: id,
    context: m.ctx, promptPrice: 0, completionPrice: 0,
    tokensPerWeek: 1_000_000_000 - i * 1_000_000, latencyMs: 500, weeklyGrowthPct: 0,
    modalities: m.modalities,
    description: `Servi via la gateway O3C. Modèle « ${id} » disponible en inférence.`,
    badges: [m.vendor, 'O3C Gateway'],
  } as Model;
}

export async function fetchLiteLLMModels(): Promise<Model[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.models;
  const base = process.env.OPENROUTER_API_BASE_URL;
  const key = process.env.OPENROUTER_API_KEY;
  if (!base) throw new Error('OPENROUTER_API_BASE_URL unset');
  const res = await fetch(`${base}/models`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`litellm /models ${res.status}`);
  const data = await res.json();
  const ids: string[] = (data?.data || []).map((m: any) => m.id).filter(Boolean);
  const models = ids.map(toModel);
  cache = { at: Date.now(), models };
  return models;
}

export function filterAndPaginate(models: Model[], p: any): { items: Model[]; total: number; hasMore: boolean } {
  let f = [...models];
  if (p.q) { const q = String(p.q).toLowerCase(); f = f.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.vendor.toLowerCase().includes(q)); }
  if (p.series?.length) f = f.filter(m => p.series.includes(m.series));
  if (p.modalities?.length) f = f.filter(m => p.modalities.some((x: string) => m.modalities.includes(x as any)));
  if (p.contextMin !== undefined) f = f.filter(m => m.context >= p.contextMin);
  if (p.contextMax !== undefined) f = f.filter(m => m.context <= p.contextMax);
  if (p.sort === 'name') f.sort((a, b) => a.name.localeCompare(b.name));
  else f.sort((a, b) => b.tokensPerWeek - a.tokensPerWeek);
  const total = f.length;
  const page = p.page || 1, limit = p.limit || 20;
  const items = f.slice((page - 1) * limit, page * limit);
  return { items, total, hasMore: page * limit < total };
}
