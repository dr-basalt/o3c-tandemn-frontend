import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ChatResponseService } from '@/lib/services/chatResponseService';
import { getTransactionHistory } from '@/lib/credits';

// Aggregate usage_charge transactions into the summary shape expected by the metrics page.
async function buildSummaryFromTransactions(
  userId: string,
  modelId?: string,
  startDate?: Date,
  endDate?: Date
) {
  const allTx = await getTransactionHistory(userId);
  const usageTx = allTx.filter(tx => {
    if (tx.type !== 'usage_charge') return false;
    const model: string = tx.metadata?.model ?? tx.metadata?.modelId ?? '';
    if (modelId && model !== modelId) return false;
    const d = new Date(tx.createdAt);
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  });

  const byModel = new Map<string, { modelId: string; count: number; totalTokens: number; totalCost: number }>();
  const byDay = new Map<string, { date: string; requests: number; tokens: number; cost: number }>();
  let totalTokens = 0;
  let totalCost = 0;

  for (const tx of usageTx) {
    const model: string = tx.metadata?.model ?? tx.metadata?.modelId ?? 'unknown';
    const tokens: number = tx.metadata?.total_tokens ?? tx.metadata?.tokens ?? 0;
    const cost = Math.abs(tx.amount);
    const day = tx.createdAt.slice(0, 10);

    const ms = byModel.get(model) ?? { modelId: model, count: 0, totalTokens: 0, totalCost: 0 };
    ms.count += 1;
    ms.totalTokens += tokens;
    ms.totalCost += cost;
    byModel.set(model, ms);

    const ds = byDay.get(day) ?? { date: day, requests: 0, tokens: 0, cost: 0 };
    ds.requests += 1;
    ds.tokens += tokens;
    ds.cost += cost;
    byDay.set(day, ds);

    totalTokens += tokens;
    totalCost += cost;
  }

  return {
    totalRequests: usageTx.length,
    totalTokens,
    totalCost,
    averageProcessingTime: 0,
    requestsByBackend: { tandemn: usageTx.length },
    requestsByModel: [...byModel.values()].sort((a, b) => b.count - a.count),
    dailyStats: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    const query = {
      userId: searchParams.get('userId') || userId,
      modelId: searchParams.get('modelId') || undefined,
      backendUsed: searchParams.get('backendUsed') as 'tandemn' | undefined,
      startDate: searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined,
      endDate: searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined,
    };

    try {
      // Try ChatResponseService first (data from internal chat)
      const summary = await ChatResponseService.getMetricsSummary(query);
      const recentResponses = await ChatResponseService.getChatResponses({ ...query, limit: 50 });

      if (summary.totalRequests > 0 || recentResponses.length > 0) {
        return NextResponse.json({ summary, recentResponses, query, dataSource: 'database' });
      }
    } catch (dbError) {
      console.log('ChatResponseService unavailable:', dbError);
    }

    // Fallback: aggregate from UserTransaction (covers /api/v1/chat/completions API usage)
    try {
      const summary = await buildSummaryFromTransactions(
        userId,
        query.modelId,
        query.startDate,
        query.endDate
      );
      if (summary.totalRequests > 0) {
        return NextResponse.json({
          summary,
          recentResponses: [],
          query,
          dataSource: 'transactions',
        });
      }
    } catch (txError) {
      console.log('Transaction aggregation failed:', txError);
    }

    const emptySummary = {
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      averageProcessingTime: 0,
      requestsByBackend: { tandemn: 0 },
      requestsByModel: [],
      dailyStats: [],
    };

    return NextResponse.json({
      summary: emptySummary,
      recentResponses: [],
      query,
      dataSource: 'no_data',
      message: 'No data available. Start using the API to see your metrics here!',
    });
  } catch (error) {
    console.error('Error in /api/metrics:', error);
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      return NextResponse.json(
        { error: 'Database connection failed.', details: error.message },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to fetch metrics', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
