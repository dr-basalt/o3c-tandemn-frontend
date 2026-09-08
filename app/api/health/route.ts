import { NextResponse } from 'next/server';
import { checkRedisHealth } from '@/lib/redis';
import mongoose from 'mongoose';

export const dynamic = 'force-dynamic';

async function checkMongo(): Promise<{ ok: boolean; latencyMs?: number }> {
  try {
    const start = Date.now();
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db?.command({ ping: 1 });
      return { ok: true, latencyMs: Date.now() - start };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

async function checkLitellm(): Promise<{ ok: boolean; latencyMs?: number }> {
  const base = process.env.OPENROUTER_API_BASE_URL;
  if (!base) return { ok: false };
  try {
    const start = Date.now();
    const url = base.replace(/\/v1\/?$/, '') + '/health';
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false };
  }
}

export async function GET() {
  const [mongo, redis, litellm] = await Promise.all([
    checkMongo(),
    checkRedisHealth().then(ok => ({ ok })),
    checkLitellm(),
  ]);

  const checks = { mongo, redis, litellm };
  const ok = mongo.ok && redis.ok;

  return NextResponse.json(
    {
      ok,
      time: new Date().toISOString(),
      service: 'o3c-platform API',
      checks,
    },
    { status: ok ? 200 : 503 }
  );
}
