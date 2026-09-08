import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { generateAPIKey, getUserAPIKeys, deactivateAPIKey, getLitellmVirtualKey } from '@/lib/credits';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'API key name is required' },
        { status: 400 }
      );
    }

    const result = await generateAPIKey(name.trim(), userId);
    
    if (result.success) {
      return NextResponse.json({
        success: true,
        apiKey: result.apiKey,
        litellmKey: result.litellmKey ?? null,
        message: result.message,
      });
    } else {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Error in POST /api/keys:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [apiKeys, litellmKey] = await Promise.all([
      getUserAPIKeys(userId),
      getLitellmVirtualKey(userId),
    ]);

    // Return full keys since these belong to the authenticated user
    // Users need to be able to copy their own API keys
    return NextResponse.json({ apiKeys, litellmKey: litellmKey ?? null });
  } catch (error) {
    console.error('Error in GET /api/keys:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get('keyId');

    if (!keyId) {
      return NextResponse.json(
        { error: 'Key ID is required' },
        { status: 400 }
      );
    }

    const success = await deactivateAPIKey(userId, keyId);
    
    if (success) {
      return NextResponse.json({ success: true, message: 'API key deleted' });
    } else {
      return NextResponse.json(
        { error: 'Failed to delete API key' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Error in DELETE /api/keys:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}