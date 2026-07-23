import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'o3c-batched-requests';

export async function POST(request: NextRequest) {
  try {
    // Get the form data
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.includes('csv') && !file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'Only CSV files are allowed' },
        { status: 400 }
      );
    }

    // Generate unique file path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `batch-inference/${timestamp}-${file.name}`;

    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Create a readable stream for server-sent events
    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      start(controller) {
        // Start the upload with progress tracking
        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: buffer,
            ContentType: file.type,
            ContentLength: file.size,
            Metadata: {
              'uploaded-at': new Date().toISOString(),
              'original-name': file.name,
            },
          },
        });

        // Track upload progress
        upload.on('httpUploadProgress', (progress) => {
          const percentComplete = Math.round((progress.loaded! / progress.total!) * 100);
          const data = JSON.stringify({
            type: 'progress',
            progress: percentComplete,
            loaded: progress.loaded,
            total: progress.total
          });
          
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        });

        // Handle completion
        upload.done()
          .then((result) => {
            const s3Path = `s3://${BUCKET_NAME}/${fileName}`;
            const data = JSON.stringify({
              type: 'complete',
              success: true,
              s3Path,
              fileName,
              fileSize: file.size,
              message: 'File uploaded successfully to S3'
            });
            
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            controller.close();
          })
          .catch((error) => {
            console.error('S3 upload error:', error);
            const data = JSON.stringify({
              type: 'error',
              error: error.message || 'Upload failed'
            });
            
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            controller.close();
          });
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (error) {
    console.error('S3 upload error:', error);
    
    // Handle specific AWS errors
    if (error instanceof Error) {
      if (error.name === 'CredentialsError') {
        return NextResponse.json(
          { error: 'AWS credentials are not configured properly' },
          { status: 500 }
        );
      }
      if (error.name === 'NoSuchBucket') {
        return NextResponse.json(
          { error: 'S3 bucket does not exist' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Failed to upload file to S3', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
