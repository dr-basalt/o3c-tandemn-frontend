import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { completeBatchInferenceTask } from '@/lib/services/batch-inference-service';
import { getBatchInferenceUrl } from '@/config/batch-inference-endpoints';
import dbConnect from '@/lib/database';
import BatchInferenceTask from '@/lib/models/BatchInferenceTask';

/**
 * Cleanup endpoint to manually fix tasks that are stuck in processing
 * but have completed on the backend
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 });
    }

    await dbConnect();

    // Verify user owns this task
    const task = await BatchInferenceTask.findOne({ taskId, clerkUserId: userId });
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    console.log(`🔧 Cleanup: Attempting to fetch completion data for task ${taskId}...`);

    // Get the batch inference URL for this task's model
    let BATCH_INFERENCE_BASE_URL: string;
    try {
      BATCH_INFERENCE_BASE_URL = getBatchInferenceUrl(task.modelName);
    } catch (error) {
      console.error(`❌ No batch inference URL for model: ${task.modelName}`);
      return NextResponse.json(
        { 
          error: 'Batch inference service not configured for this model',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 503 }
      );
    }

    // Try to get completion data from backend
    try {
      // First check status
      const statusResponse = await fetch(`${BATCH_INFERENCE_BASE_URL}/batch_task_status/${taskId}`);
      
      if (!statusResponse.ok) {
        return NextResponse.json(
          {
            error: 'Backend not available',
            message: `Could not fetch status from backend (status ${statusResponse.status})`,
          },
          { status: 503 }
        );
      }

      const statusData = await statusResponse.json();
      console.log(`📊 Backend status for task ${taskId}:`, statusData);

      // Check if task is actually completed on backend
      if (statusData.status !== 'completed') {
        return NextResponse.json(
          {
            error: 'Task not completed',
            message: `Task status on backend is '${statusData.status}', not 'completed'`,
            backendStatus: statusData,
          },
          { status: 400 }
        );
      }

      // Try to get results/S3 info
      console.log(`🔍 Fetching S3 info from /get_results...`);
      const resultsResponse = await fetch(`${BATCH_INFERENCE_BASE_URL}/get_results/${taskId}`);
      
      if (!resultsResponse.ok) {
        // Even if we can't get S3 info, we can still mark as completed
        console.warn(`⚠️  Could not fetch S3 info (status ${resultsResponse.status}), marking as completed without output file`);
        
        await completeBatchInferenceTask({
          taskId,
          outputFile: undefined, // Will be filled in when download is attempted
        });

        return NextResponse.json({
          success: true,
          message: 'Task marked as completed (S3 info not available yet)',
          taskId,
          status: 'completed',
          note: 'S3 info will be fetched when you attempt to download',
        });
      }

      const resultsData = await resultsResponse.json();
      console.log(`✅ Got S3 info from backend:`, resultsData);

      // Update task with completion data
      await completeBatchInferenceTask({
        taskId,
        outputFile: {
          s3Path: resultsData.s3_path || `s3://o3c-results/results/${resultsData.filename}`,
          s3Bucket: resultsData.s3_bucket || 'o3c-results',
          s3Key: resultsData.s3_key || `results/${resultsData.filename}`,
          fileSize: resultsData.file_size,
        },
      });

      console.log(`💾 Task ${taskId} marked as completed with S3 info`);

      return NextResponse.json({
        success: true,
        message: 'Task successfully marked as completed with S3 info',
        taskId,
        status: 'completed',
        outputFile: {
          s3Path: resultsData.s3_path,
          fileSize: resultsData.file_size,
          filename: resultsData.filename,
        },
      });
    } catch (error) {
      console.error(`❌ Error during cleanup for task ${taskId}:`, error);
      return NextResponse.json(
        {
          error: 'Cleanup failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in cleanup endpoint:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

