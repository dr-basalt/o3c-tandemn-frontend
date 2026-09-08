import { Suspense } from 'react';
import { getAllModels, TandemnModel } from '@/config/models';
import ModelsClient from './models-client';
import ModelsLoading from './loading';

async function fetchLitellmModels(): Promise<TandemnModel[]> {
  const baseUrl = process.env.OPENROUTER_API_BASE_URL;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!baseUrl || !apiKey || process.env.GATEWAY_ENABLED !== 'true') return [];

  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 60 },
  });
  if (!res.ok) return [];

  const data = await res.json();
  const items: { id: string }[] = data?.data ?? [];
  if (items.length === 0) return [];

  return items.map((m) => ({
    id: m.id,
    name: m.id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    provider: 'O3C',
    description: `Model ${m.id} disponible via api.ori3com.cloud`,
    context_length: 128000,
    input_price_per_1m: 0,
    output_price_per_1m: 0,
    capabilities: ['text'],
    max_tokens: 4096,
    is_available: true,
  }));
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
