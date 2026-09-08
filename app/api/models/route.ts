import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/mock/db';
import { modelsQuerySchema } from '@/lib/zod-schemas';

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

async function fetchGatewayModels() {
  const baseUrl = process.env.OPENROUTER_API_BASE_URL;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!baseUrl || !apiKey) return null;

  const [modelsRes, priceIndex] = await Promise.all([
    fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 60 },
    }),
    fetchModelInfo(baseUrl, apiKey).catch(() => ({})),
  ]);

  if (!modelsRes.ok) return null;

  const data = await modelsRes.json();
  const litellmModels: { id: string; description?: string }[] = data?.data ?? [];
  if (litellmModels.length === 0) return null;

  return litellmModels.map((m) => {
    const info = priceIndex[m.id] ?? {};
    const promptPrice = info.input_cost_per_token != null
      ? Number((info.input_cost_per_token * 1_000_000).toFixed(6))
      : 0;
    const completionPrice = info.output_cost_per_token != null
      ? Number((info.output_cost_per_token * 1_000_000).toFixed(6))
      : 0;
    const context = info.max_input_tokens ?? info.max_tokens ?? 128000;

    return {
      id: m.id,
      name: m.id,
      vendor: 'o3c',
      series: 'Other' as const,
      short: m.id,
      context,
      promptPrice,
      completionPrice,
      tokensPerWeek: 0,
      latencyMs: 500,
      weeklyGrowthPct: 0,
      modalities: ['text'] as ('text')[],
      description: m.description ?? m.id,
      badges: ['O3C Gateway'],
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const queryParams = {
      q: searchParams.get('q') || undefined,
      modalities: searchParams.getAll('modalities') || undefined,
      series: searchParams.getAll('series') || undefined,
      contextMin: searchParams.get('contextMin') ? Number(searchParams.get('contextMin')) : undefined,
      contextMax: searchParams.get('contextMax') ? Number(searchParams.get('contextMax')) : undefined,
      promptPriceMax: searchParams.get('promptPriceMax') ? Number(searchParams.get('promptPriceMax')) : undefined,
      sort: searchParams.get('sort') || undefined,
      view: searchParams.get('view') || undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : 20,
    };

    const validatedParams = modelsQuerySchema.parse(queryParams);

    if (process.env.GATEWAY_ENABLED === 'true') {
      const gatewayModels = await fetchGatewayModels();
      if (gatewayModels) {
        const page = validatedParams.page ?? 1;
        const limit = validatedParams.limit ?? 20;
        const start = (page - 1) * limit;
        const items = gatewayModels.slice(start, start + limit);
        return NextResponse.json(
          { items, total: gatewayModels.length, hasMore: start + limit < gatewayModels.length, page },
          { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
        );
      }
    }

    const result = db.getModels(validatedParams);
    return NextResponse.json(
      { ...result, page: validatedParams.page || 1 },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
    );
  } catch (error) {
    console.error('Error in /api/models:', error);
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
  }
}
