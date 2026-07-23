import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getBatchInferenceTask, updateBatchInferenceProgress } from '@/lib/services/batch-inference-service';
import { getBatchInferenceUrl } from '@/config/batch-inference-endpoints';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    // Authenticate user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    // Get task from MongoDB to verify ownership
    const task = await getBatchInferenceTask(taskId);

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Verify task belongs to the user
    if (task.clerkUserId !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Get the batch inference URL for this task's model
    let BATCH_INFERENCE_BASE_URL: string;
    try {
      BATCH_INFERENCE_BASE_URL = getBatchInferenceUrl(task.modelName);
    } catch (error) {
      console.error(`❌ No batch inference URL for model: ${task.modelName}`);
      // Return MongoDB status only if we can't reach the backend
      return NextResponse.json({
        task_id: task.taskId,
        model_name: task.modelName,
        status: task.status,
        message: 'Batch inference service not configured for this model',
        progress: task.progress,
        performance: task.performanceMetrics,
        created_at: task.queuedAt,
        started_at: task.startedAt,
        completed_at: task.completedAt,
      });
    }

    // Fetch live status from FastAPI backend
    let backendStatus;
    try {
      const backendResponse = await fetch(`${BATCH_INFERENCE_BASE_URL}/batch_task_status/${taskId}`);
      
      if (backendResponse.ok) {
        backendStatus = await backendResponse.json();
        console.log(`📊 Fetched live status from backend for task ${taskId}:`, backendStatus);

        // Update MongoDB with the latest progress from backend
        if (backendStatus.status && backendStatus.progress) {
          const updateData: any = {
            progress: {
              linesProcessed: backendStatus.progress.lines_processed || 0,
              batchesSent: backendStatus.progress.batches_sent || 0,
              currentBufferSize: backendStatus.progress.current_buffer_size || 0,
            },
            performanceMetrics: backendStatus.performance ? {
              linesPerSecond: backendStatus.performance.lines_per_second || 0,
              totalBatches: backendStatus.progress.batches_sent || 0,
            } : undefined,
          };

          await updateBatchInferenceProgress({
            taskId,
            ...updateData,
          });
          console.log(`✅ Updated MongoDB with backend progress for task ${taskId} (status: ${backendStatus.status})`);
          
          // If backend says completed, try to get the S3 path from /get_results endpoint
          if (backendStatus.status === 'completed' && !task.outputFile?.s3Path) {
            console.log(`🏁 Backend reports task ${taskId} is completed, fetching S3 path...`);
            try {
              const resultsResponse = await fetch(`${BATCH_INFERENCE_BASE_URL}/get_results/${taskId}`);
              if (resultsResponse.ok) {
                const resultsData = await resultsResponse.json();
                
                // The /get_results endpoint returns download_url, filename, file_size
                // Save completion data to MongoDB
                if (resultsData.download_url) {
                  const { completeBatchInferenceTask } = await import('@/lib/services/batch-inference-service');
                  
                  await completeBatchInferenceTask({
                    taskId,
                    outputFile: {
                      s3Path: resultsData.s3_path || `s3://o3c-results/results/${resultsData.filename}`,
                      s3Bucket: resultsData.s3_bucket || 'o3c-results',
                      s3Key: resultsData.s3_key || `results/${resultsData.filename}`,
                      fileSize: resultsData.file_size,
                    },
                  });
                  
                  console.log(`✅ Saved completion data to MongoDB for task ${taskId}`);
                  console.log(`📄 S3 Path: ${resultsData.s3_path || 'constructed from filename'}`);
                  console.log(`📦 Filename: ${resultsData.filename}`);
                  console.log(`📊 File size: ${resultsData.file_size} bytes`);
                } else {
                  console.warn(`⚠️  /get_results returned success but no download_url for task ${taskId}`);
                }
              } else if (resultsResponse.status === 404) {
                // File might still be uploading - don't mark as error
                console.log(`⏳ File not ready yet for task ${taskId} (status 404), will retry later`);
              } else {
                console.warn(`⚠️  /get_results returned ${resultsResponse.status} for task ${taskId}`);
              }
            } catch (resultsError) {
              console.error(`❌ Failed to fetch results info from backend for task ${taskId}:`, resultsError);
            }
          }
        }
      } else {
        console.warn(`⚠️  Backend returned ${backendResponse.status} for task ${taskId}, falling back to MongoDB data`);
      }
    } catch (backendError) {
      console.error(`❌ Failed to fetch from backend for task ${taskId}:`, backendError);
      // Continue with MongoDB data as fallback
    }

    // If we got backend status, use it (it's more up-to-date)
    // Otherwise fall back to MongoDB data
    if (backendStatus && backendStatus.status !== 'unknown') {
      return NextResponse.json({
        task_id: taskId,
        model_name: task.modelName,
        status: backendStatus.status,
        message: backendStatus.status === 'processing' ? 'Processing batch inference...' : 
                 backendStatus.status === 'queued' ? 'Task queued' : undefined,
        progress: backendStatus.progress || {
          lines_processed: 0,
          batches_sent: 0,
          current_buffer_size: 0,
        },
        performance: backendStatus.performance || {
          elapsed_seconds: 0,
          lines_per_second: 0,
        },
        started_at: backendStatus.started_at,
        // Include MongoDB data for completed status
        final_file_path: task.outputFile?.s3Path,
        output_file: task.outputFile ? {
          s3_path: task.outputFile.s3Path,
          s3_bucket: task.outputFile.s3Bucket,
          s3_key: task.outputFile.s3Key,
          file_size: task.outputFile.fileSize,
        } : undefined,
      });
    }

    // Fallback to MongoDB data if backend is unavailable
    let elapsedSeconds = 0;
    if (task.startedAt) {
      const endTime = task.completedAt || new Date();
      elapsedSeconds = (endTime.getTime() - new Date(task.startedAt).getTime()) / 1000;
    }

    const response = {
      task_id: task.taskId,
      model_name: task.modelName,
      status: task.status,
      message: task.error?.message || (task.status === 'processing' ? 'Processing batch inference...' : undefined),
      
      progress: {
        lines_processed: task.progress.linesProcessed || 0,
        batches_sent: task.progress.batchesSent || 0,
        current_buffer_size: task.progress.currentBufferSize || 0,
        last_processed_line: task.progress.lastProcessedLine || 0,
        next_byte_position: task.progress.nextBytePosition || 0,
        percent_complete: task.progress.percentComplete,
      },
      
      performance: {
        elapsed_seconds: elapsedSeconds,
        lines_per_second: task.performanceMetrics?.linesPerSecond || 0,
        tokens_per_second: task.performanceMetrics?.tokensPerSecond || 0,
        average_latency_ms: task.performanceMetrics?.averageLatencyMs || 0,
        peak_buffer_size: task.performanceMetrics?.peakBufferSize || 0,
        total_batches: task.performanceMetrics?.totalBatches || 0,
      },
      
      token_metrics: task.tokenMetrics ? {
        total_input_tokens: task.tokenMetrics.totalInputTokens || 0,
        total_output_tokens: task.tokenMetrics.totalOutputTokens || 0,
        total_tokens: task.tokenMetrics.totalTokens || 0,
        average_input_tokens_per_request: task.tokenMetrics.averageInputTokensPerRequest,
        average_output_tokens_per_request: task.tokenMetrics.averageOutputTokensPerRequest,
      } : undefined,
      
      queued_at: task.queuedAt,
      started_at: task.startedAt,
      completed_at: task.completedAt,
      total_duration_ms: task.totalDurationMs,
      
      final_file_path: task.outputFile?.s3Path,
      output_file: task.outputFile ? {
        s3_path: task.outputFile.s3Path,
        s3_bucket: task.outputFile.s3Bucket,
        s3_key: task.outputFile.s3Key,
        file_size: task.outputFile.fileSize,
      } : undefined,
      
      error: task.error?.message,
      error_details: task.error,
      
      inputFile: task.inputFile,
      processingConfig: task.processingConfig,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error getting batch inference status:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
