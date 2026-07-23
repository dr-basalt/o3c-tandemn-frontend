import { NextRequest, NextResponse } from 'next/server';
import { o3cClient } from '@/lib/o3c-client';

export async function GET(request: NextRequest) {
  try {
    console.log('Checking o3c backend health...');

    // Get health status from o3c backend
    const healthResponse = await o3cClient.health();
    
    console.log('Health response:', healthResponse);

    return NextResponse.json({
      status: healthResponse.status,
      machines: healthResponse.machines,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('O3C health check error:', error);
    return NextResponse.json(
      { 
        status: 'error',
        error: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
