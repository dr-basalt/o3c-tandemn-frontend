import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getTransactionHistory, getLitellmVirtualKey } from '@/lib/credits';
import { getLitellmKeyInfo, getLitellmSpendLogs } from '@/lib/litellm-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ModelStat {
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
}

interface DayStat {
  date: string;
  requests: number;
  total_tokens: number;
  cost: number;
}

function aggregateTransactions(
  transactions: Awaited<ReturnType<typeof getTransactionHistory>>,
  startDate?: string,
  endDate?: string
): { byModel: ModelStat[]; byDay: DayStat[]; total: ModelStat } {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate + 'T23:59:59Z') : null;

  const byModel = new Map<string, ModelStat>();
  const byDay = new Map<string, DayStat>();
  const total: ModelStat = { model: '__total__', requests: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost: 0 };

  for (const tx of transactions) {
    if (tx.type !== 'usage_charge') continue;

    const txDate = new Date(tx.createdAt);
    if (start && txDate < start) continue;
    if (end && txDate > end) continue;

    const model: string = tx.metadata?.model ?? tx.metadata?.modelId ?? 'unknown';
    const inputTokens: number = tx.metadata?.input_tokens ?? tx.metadata?.inputTokens ?? 0;
    const outputTokens: number = tx.metadata?.output_tokens ?? tx.metadata?.outputTokens ?? 0;
    const totalTokens: number = tx.metadata?.total_tokens ?? tx.metadata?.tokens ?? (inputTokens + outputTokens);
    const cost = Math.abs(tx.amount);
    const day = tx.createdAt.slice(0, 10);

    // by model
    const ms = byModel.get(model) ?? { model, requests: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost: 0 };
    ms.requests += 1;
    ms.input_tokens += inputTokens;
    ms.output_tokens += outputTokens;
    ms.total_tokens += totalTokens;
    ms.cost += cost;
    byModel.set(model, ms);

    // by day
    const ds = byDay.get(day) ?? { date: day, requests: 0, total_tokens: 0, cost: 0 };
    ds.requests += 1;
    ds.total_tokens += totalTokens;
    ds.cost += cost;
    byDay.set(day, ds);

    // total
    total.requests += 1;
    total.input_tokens += inputTokens;
    total.output_tokens += outputTokens;
    total.total_tokens += totalTokens;
    total.cost += cost;
  }

  return {
    byModel: [...byModel.values()].sort((a, b) => b.cost - a.cost),
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    total,
  };
}

function toCSV(byModel: ModelStat[], byDay: DayStat[]): string {
  const lines: string[] = [
    '# Usage by model',
    'model,requests,input_tokens,output_tokens,total_tokens,cost_usd',
    ...byModel.map(m =>
      `${m.model},${m.requests},${m.input_tokens},${m.output_tokens},${m.total_tokens},${m.cost.toFixed(6)}`
    ),
    '',
    '# Usage by day',
    'date,requests,total_tokens,cost_usd',
    ...byDay.map(d => `${d.date},${d.requests},${d.total_tokens},${d.cost.toFixed(6)}`),
  ];
  return lines.join('\n');
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date') ?? undefined;
    const endDate = searchParams.get('end_date') ?? undefined;
    const format = searchParams.get('format') ?? 'json';

    const [transactions, litellmKey] = await Promise.all([
      getTransactionHistory(userId),
      getLitellmVirtualKey(userId),
    ]);

    const { byModel, byDay, total } = aggregateTransactions(transactions, startDate, endDate);

    // Enrich with litellm key info (total spend from litellm's own DB)
    const litellmInfo = litellmKey ? await getLitellmKeyInfo(litellmKey) : null;

    // Try litellm spend logs for per-model breakdown from litellm side (optional)
    const litellmLogs = litellmKey
      ? await getLitellmSpendLogs(litellmKey, startDate, endDate)
      : [];

    if (format === 'csv') {
      return new NextResponse(toCSV(byModel, byDay), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="o3c-usage-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json({
      by_model: byModel,
      by_day: byDay,
      total: {
        requests: total.requests,
        input_tokens: total.input_tokens,
        output_tokens: total.output_tokens,
        total_tokens: total.total_tokens,
        cost: total.cost,
      },
      litellm: {
        spend: litellmInfo?.spend ?? null,
        max_budget: litellmInfo?.max_budget ?? null,
        spend_logs_count: litellmLogs.length,
      },
      data_source: 'mongodb_transactions',
    }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    console.error('Error in /api/v1/usage:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
