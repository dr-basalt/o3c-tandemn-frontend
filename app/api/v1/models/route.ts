import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function fetchFromLitellm() {
  const baseUrl = process.env.OPENROUTER_API_BASE_URL;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!baseUrl || !apiKey) return null;

  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

// GET /api/v1/models - List all available models (proxied from litellm-o3c)
export async function GET(_request: NextRequest) {
  try {
    const data = await fetchFromLitellm();
    if (data) {
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
      });
    }

    // Fallback to static config if litellm-o3c unavailable
    const { getAllModels } = await import('@/config/models');
    const models = getAllModels();
    return NextResponse.json(
      { object: 'list', data: models, total: models.length },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
    );
  } catch (error) {
    console.error('Error in /api/v1/models:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/v1/models - Get specific model info via body { model_id }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model_id } = body;

    if (!model_id) {
      return NextResponse.json({ error: 'model_id is required' }, { status: 400 });
    }

    const baseUrl = process.env.OPENROUTER_API_BASE_URL;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (baseUrl && apiKey) {
      const modelInfoBase = baseUrl.replace(/\/v1$/, '');
      const res = await fetch(
        `${modelInfoBase}/model_info?model=${encodeURIComponent(model_id)}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ data });
      }
    }

    // Fallback to static config
    const { getModelById } = await import('@/config/models');
    const model = getModelById(model_id);
    if (!model) {
      return NextResponse.json({ error: `Model '${model_id}' not found` }, { status: 404 });
    }
    return NextResponse.json({ data: model });
  } catch (error) {
    console.error('Error in /api/v1/models POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
