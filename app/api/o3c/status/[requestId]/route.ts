import { NextRequest, NextResponse } from 'next/server';
import { o3cClient } from '@/lib/o3c-client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params;

    if (!requestId) {
      return NextResponse.json(
        { error: 'Request ID is required' },
        { status: 400 }
      );
    }

    console.log('Checking status for request:', requestId);

    // Get the inference status from o3c backend
    const statusResponse = await o3cClient.getInferenceStatus(requestId);
    
    console.log('Status response:', statusResponse);

    return NextResponse.json({
      request_id: statusResponse.request_id,
      status: statusResponse.status,
      result: statusResponse.result,
      processing_time: statusResponse.processing_time,
    });

  } catch (error) {
    console.error('O3C status check error:', error);
    return NextResponse.json(
      { error: `Status check failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
