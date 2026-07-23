import { NextRequest, NextResponse } from 'next/server';
import { o3cClient } from '@/lib/o3c-client';
import { openRouterClient } from '@/lib/openrouter-client';

export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const body = await request.json();
    const { model, messages, max_tokens = 150 } = body;

    if (!model || !messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Missing required fields: model and messages array' },
        { status: 400 }
      );
    }

    // Convert the chat format to o3c format
    const lastMessage = messages[messages.length - 1];
    const inputText = lastMessage.content;

    // Start inference with o3c backend
    const inferenceRequest = {
      model_name: model,
      input_text: inputText,
      max_tokens: max_tokens,
    };

    console.log('Starting o3c inference:', inferenceRequest);

    let o3cResponse: any = null;
    let o3cError: string | null = null;

    // Try o3c backend first with timeout
    try {
      o3cResponse = await o3cClient.inferWithTimeout(inferenceRequest, 10000); // 10 second timeout
      console.log('O3C inference started:', o3cResponse);
    } catch (error) {
      o3cError = error instanceof Error ? error.message : 'Unknown o3c error';
      console.warn('O3C inference failed, falling back to OpenRouter:', o3cError);
    }

    // If o3c failed or timed out, try OpenRouter
    if (!o3cResponse) {
      try {
        console.log('Falling back to OpenRouter API...');
        
        // Map o3c model names to OpenRouter model names if needed
        const openRouterModel = mapModelToOpenRouter(model);
        
        const openRouterRequest = {
          model: openRouterModel,
          messages: messages,
          max_tokens: max_tokens,
        };

        const openRouterResponse = await openRouterClient.chatWithTimeout(openRouterRequest, 30000);
        console.log('OpenRouter response received');

        return NextResponse.json({
          ...openRouterResponse,
          _fallback: 'openrouter', // Flag to indicate this was a fallback
        });

      } catch (openRouterError) {
        console.error('Both o3c and OpenRouter failed:', { o3cError, openRouterError });
        return NextResponse.json(
          { 
            error: `All inference methods failed. O3C: ${o3cError}. OpenRouter: ${openRouterError instanceof Error ? openRouterError.message : 'Unknown error'}` 
          },
          { status: 500 }
        );
      }
    }

    // If o3c succeeded, return the response (you'll need to implement polling for actual results)
    return NextResponse.json({
      id: o3cResponse.request_id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `Inference started with request ID: ${o3cResponse.request_id}. This is a placeholder response - you'll need to implement polling for the actual result.`,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      _fallback: 'o3c', // Flag to indicate this was o3c
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: `Chat API failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

// Helper function to map o3c model names to OpenRouter model names
function mapModelToOpenRouter(o3cModel: string): string {
  // Add mappings as needed - for now, return the same name
  const modelMappings: Record<string, string> = {
    // Example mappings:
    // 'llama-3.1-70b': 'meta/llama-3.1-70b',
    // 'gemma-2b': 'google/gemma-2b',
  };

  return modelMappings[o3cModel] || o3cModel;
}
