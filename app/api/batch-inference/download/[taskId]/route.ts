import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getBatchInferenceTask } from '@/lib/services/batch-inference-service';
import { getBatchInferenceUrl } from '@/config/batch-inference-endpoints';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

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

    // Get task from MongoDB
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

    // First try to use stored S3 path if we have it (fastest)
    if (task.outputFile?.s3Bucket && task.outputFile?.s3Key) {
      // Use the stored S3 path - proceed with normal flow below
      console.log(`📦 Using stored S3 path for task ${taskId}`);
    } else {
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

      // No S3 path in MongoDB - try to get it from the backend with retry logic
      console.log(`🔍 No S3 path in MongoDB for task ${taskId}, checking backend with retry...`);
      
      // Retry logic: 3 attempts with exponential backoff (0s, 2s, 4s)
      const maxAttempts = 3;
      let lastError: any = null;
      
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          if (attempt > 0) {
            const delayMs = 2000 * attempt; // 2s, 4s
            console.log(`⏳ Waiting ${delayMs}ms before retry attempt ${attempt + 1}...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
          
          console.log(`🔄 Attempt ${attempt + 1}/${maxAttempts}: Fetching from /get_results...`);
          const backendResponse = await fetch(`${BATCH_INFERENCE_BASE_URL}/get_results/${taskId}`);
          
          if (backendResponse.ok) {
            const backendData = await backendResponse.json();
            console.log(`✅ Got download info from backend for task ${taskId} (attempt ${attempt + 1}):`, backendData);
            
            // Store S3 info in MongoDB for future requests
            try {
              const { completeBatchInferenceTask } = await import('@/lib/services/batch-inference-service');
              
              // Extract S3 bucket and key from filename or path
              // The backend uses the format: s3://{bucket}/{key}
              const filename = backendData.filename || '';
              
              await completeBatchInferenceTask({
                taskId,
                outputFile: {
                  s3Path: backendData.s3_path || `s3://o3c-results/results/${filename}`,
                  s3Bucket: backendData.s3_bucket || 'o3c-results',
                  s3Key: backendData.s3_key || `results/${filename}`,
                  fileSize: backendData.file_size,
                },
              });
              
              console.log(`💾 Saved S3 info to MongoDB for task ${taskId}`);
            } catch (saveError) {
              console.error(`⚠️  Failed to save S3 info to MongoDB:`, saveError);
              // Don't fail the request, just log the error
            }
            
            // Return the backend's download URL directly
            return NextResponse.json({
              downloadUrl: backendData.download_url,
              filename: backendData.filename || 'batch_results.csv',
              fileSize: backendData.file_size,
              lastModified: backendData.last_modified,
              expiresIn: 3600,
              expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
            });
          } else if (backendResponse.status === 404) {
            // 404 might mean file not uploaded yet, retry
            lastError = { status: 404, message: 'File not found yet' };
            console.warn(`⚠️  Attempt ${attempt + 1}: /get_results returned 404, file might still be uploading...`);
            continue;
          } else if (backendResponse.status === 400) {
            // Task not completed yet - this is different from 404
            const errorData = await backendResponse.json().catch(() => ({}));
            return NextResponse.json(
              {
                error: 'Results file is being uploaded',
                message: 'Processing is complete, but the results file is still being uploaded to S3. Please try again in a few moments.',
                status: 'uploading',
                details: errorData.detail,
              },
              { status: 202 }
            );
          } else {
            lastError = { status: backendResponse.status, message: 'Backend error' };
            console.error(`❌ Backend /get_results returned ${backendResponse.status} for task ${taskId}`);
          }
        } catch (err) {
          lastError = err;
          console.error(`❌ Attempt ${attempt + 1} error calling backend /get_results for task ${taskId}:`, err);
        }
      }
      
      // All attempts failed
      console.error(`❌ All ${maxAttempts} attempts failed for task ${taskId}. Last error:`, lastError);
      
      if (lastError?.status === 404) {
        return NextResponse.json(
          {
            error: 'Results file still uploading',
            message: 'The results file is still being uploaded to S3. This is taking longer than expected. Please try again in 10-30 seconds.',
            status: 'uploading',
          },
          { status: 202 }
        );
      }
      
      return NextResponse.json(
        {
          error: 'Could not retrieve results',
          message: 'Failed to retrieve results after multiple attempts. Please try again.',
        },
        { status: 503 }
      );
    }

    try {
      // Get file metadata
      const headCommand = new HeadObjectCommand({
        Bucket: task.outputFile.s3Bucket,
        Key: task.outputFile.s3Key,
      });

      const headResponse = await s3Client.send(headCommand);

      // Generate presigned URL (valid for 1 hour)
      const getCommand = new GetObjectCommand({
        Bucket: task.outputFile.s3Bucket,
        Key: task.outputFile.s3Key,
      });

      const downloadUrl = await getSignedUrl(s3Client, getCommand, {
        expiresIn: 3600, // 1 hour
      });

      // Extract filename from S3 key
      const filename = task.outputFile.s3Key.split('/').pop() || 'results.csv';

      return NextResponse.json({
        downloadUrl,
        filename,
        fileSize: headResponse.ContentLength || task.outputFile.fileSize,
        lastModified: headResponse.LastModified?.toISOString(),
        expiresIn: 3600,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      });
    } catch (s3Error: any) {
      console.error('S3 error:', s3Error);

      if (s3Error.name === 'NoSuchKey') {
        return NextResponse.json(
          {
            error: 'File not found in S3',
            details: `The output file could not be found: ${task.outputFile.s3Key}`,
          },
          { status: 404 }
        );
      }

      if (s3Error.name === 'NoSuchBucket') {
        return NextResponse.json(
          {
            error: 'S3 bucket not found',
            details: `The S3 bucket does not exist: ${task.outputFile.s3Bucket}`,
          },
          { status: 404 }
        );
      }

      throw s3Error;
    }
  } catch (error) {
    console.error('Error generating download URL:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
