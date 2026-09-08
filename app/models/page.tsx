import { Suspense } from 'react';
import { getAllModels, TandemnModel } from '@/config/models';
import ModelsClient from './models-client';
import ModelsLoading from './loading';

// Force SSR — env vars (OPENROUTER_API_BASE_URL, OPENROUTER_API_KEY) sont
// injectées par k8s au runtime, pas disponibles au build time CI.
export const dynamic = 'force-dynamic';

type ModelInfoEntry = {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  max_tokens?: number;
  max_input_tokens?: number;
};

async function fetchModelInfo(base: string, apiKey: string): Promise<Record<string, ModelInfoEntry>> {
  const modelInfoBase = base.replace(/\/v1$/, '');
  const res = await fetch(`${modelInfoBase}/model_info`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) return {};

  const data = await res.json();
  const index: Record<string, ModelInfoEntry> = {};
  for (const entry of data?.data ?? []) {
    const id: string | undefined = entry.model_name ?? entry.model_info?.id;
    if (id && entry.model_info) {
      index[id] = entry.model_info;
    }
  }
  return index;
}

async function fetchLitellmModels(): Promise<TandemnModel[]> {
  const baseUrl = process.env.OPENROUTER_API_BASE_URL;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!baseUrl || !apiKey || process.env.GATEWAY_ENABLED !== 'true') return [];

  const [res, priceIndex] = await Promise.all([
    fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    }),
    fetchModelInfo(baseUrl, apiKey).catch(() => ({})),
  ]);

  if (!res.ok) return [];

  const data = await res.json();
  const items: { id: string }[] = data?.data ?? [];
  if (items.length === 0) return [];

  return items.map((m) => {
    const info = priceIndex[m.id] ?? {};
    const input_price_per_1m = info.input_cost_per_token != null
      ? Number((info.input_cost_per_token * 1_000_000).toFixed(6))
      : 0;
    const output_price_per_1m = info.output_cost_per_token != null
      ? Number((info.output_cost_per_token * 1_000_000).toFixed(6))
      : 0;
    const context_length = info.max_input_tokens ?? info.max_tokens ?? 128000;

    return {
      id: m.id,
      name: m.id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      provider: 'O3C',
      description: `Model ${m.id} disponible via api.ori3com.cloud`,
      context_length,
      input_price_per_1m,
      output_price_per_1m,
      capabilities: ['text'],
      max_tokens: info.max_tokens ?? 4096,
      is_available: true,
    };
  });
}

async function getModels(): Promise<TandemnModel[]> {
  try {
    const gateway = await fetchLitellmModels();
    if (gateway.length > 0) return gateway;
  } catch (error) {
    console.error('Gateway models fetch failed:', error);
  }
  return getAllModels();
}

export default async function ModelsPage() {
  const models = await getModels();

  return (
    <Suspense fallback={<ModelsLoading />}>
      <ModelsClient initialModels={models} />
    </Suspense>
  );
}
