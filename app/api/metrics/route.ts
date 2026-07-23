import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ChatResponseService } from '@/lib/services/chatResponseService';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    
    // Parse query parameters
    const query = {
      userId: searchParams.get('userId') || userId,
      modelId: searchParams.get('modelId') || undefined,
      backendUsed: searchParams.get('backendUsed') as 'o3c' | undefined,
      startDate: searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined,
      endDate: searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined,
    };

    try {
      // Try to get real metrics data
      const summary = await ChatResponseService.getMetricsSummary(query);
      const recentResponses = await ChatResponseService.getChatResponses({
        ...query,
        limit: 50,
      });

      // If we have data, return it
      if (summary.totalRequests > 0 || recentResponses.length > 0) {
        return NextResponse.json({
          summary,
          recentResponses,
          query,
          dataSource: 'database'
        });
      }
    } catch (dbError) {
      console.log('Database unavailable:', dbError);
    }

    // Return empty data structure when no real data is available
    const emptySummary = {
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      averageProcessingTime: 0,
      requestsByBackend: {
        o3c: 0,
      },
      requestsByModel: [],
      dailyStats: [],
    };

    return NextResponse.json({
      summary: emptySummary,
      recentResponses: [],
      query,
      dataSource: 'no_data',
      message: 'No data available. Start using the chat to see your metrics here!'
    });
  } catch (error) {
    console.error('Error in /api/metrics:', error);
    
    // Check if it's a MongoDB connection error
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      return NextResponse.json(
        { 
          error: 'Database connection failed. Please check your MongoDB connection.',
          details: error.message 
        },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch metrics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
