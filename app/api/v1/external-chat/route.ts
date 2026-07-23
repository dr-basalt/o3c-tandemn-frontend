import { NextRequest, NextResponse } from 'next/server';
import { externalChatAPI, o3cChatAPI, convertMessages, ExternalChatAPI } from '@/lib/external-chat-api';
import { externalChatCompletionSchema } from '@/lib/zod-schemas';
import { validateAPIKey, chargeForUsage, getUserCredits } from '@/lib/credits';
import { calculateCost } from '@/config/models';

export async function POST(request: NextRequest) {
  try {
    // Extract API key from Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header. Use: Authorization: Bearer YOUR_API_KEY' },
        { status: 401 }
      );
    }

    const apiKey = authHeader.substring(7);
    
    // Validate API key
    const validation = await validateAPIKey(apiKey);
    if (!validation.valid || !validation.userId) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    const userId = validation.userId;

    // Parse and validate request body
    const body = await request.json();
    
    try {
      const validatedRequest = externalChatCompletionSchema.parse(body);
      
      // Ensure system message is present
      validatedRequest.messages = ExternalChatAPI.ensureSystemMessage(validatedRequest.messages);
      
      // Check if streaming is requested
      if (validatedRequest.stream) {
        return handleStreamingRequestWithFallback(validatedRequest, userId, request);
      } else {
        return handleNonStreamingRequestWithFallback(validatedRequest, userId, request);
      }
      
    } catch (validationError) {
      return NextResponse.json(
        { 
          error: 'Invalid request format',
          details: validationError instanceof Error ? validationError.message : 'Validation failed'
        },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Error in /api/v1/external-chat:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Try O3C first, fallback to OpenRouter if O3C fails
async function handleNonStreamingRequestWithFallback(
  validatedRequest: any,
  userId: string,
  request: NextRequest
): Promise<NextResponse> {
  try {
    // First, try O3C's internal system
    console.log('Attempting O3C internal chat...');
    const o3cResponse = await tryO3CChat(validatedRequest, userId, request);
    
    if (o3cResponse) {
      console.log('O3C internal chat succeeded');
      return o3cResponse;
    }
    
    console.log('O3C internal chat failed, trying OpenRouter fallback...');
    
    // Fallback to OpenRouter
    return await handleOpenRouterRequest(validatedRequest, userId, false);
    
  } catch (error) {
    console.error('Both O3C and OpenRouter failed:', error);
    return NextResponse.json(
      { 
        error: 'All chat services are currently unavailable',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 503 }
    );
  }
}

// Try O3C first, fallback to OpenRouter if O3C fails (streaming)
async function handleStreamingRequestWithFallback(
  validatedRequest: any,
  userId: string,
  request: NextRequest
): Promise<NextResponse> {
  try {
    // First, try O3C's internal system
    console.log('Attempting O3C internal streaming chat...');
    const o3cResponse = await tryO3CChat(validatedRequest, userId, request);
    
    if (o3cResponse) {
      console.log('O3C internal streaming chat succeeded');
      return o3cResponse;
    }
    
    console.log('O3C internal streaming chat failed, trying OpenRouter fallback...');
    
    // Fallback to OpenRouter streaming
    return await handleOpenRouterRequest(validatedRequest, userId, true);
    
  } catch (error) {
    console.error('Both O3C and OpenRouter streaming failed:', error);
    return NextResponse.json(
      { 
        error: 'All chat services are currently unavailable',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 503 }
    );
  }
}

// Try to use O3C's external API system
async function tryO3CChat(
  validatedRequest: any,
  userId: string,
  request: NextRequest
): Promise<NextResponse | null> {
  try {
    // Use the new O3C API endpoint directly
    // Convert message roles to match O3C API expectations (capital first letter)
    const o3cMessages = validatedRequest.messages.map((msg: any) => ({
      ...msg,
      role: msg.role === 'system' ? 'System' : msg.role
    }));
    
    const o3cRequestBody = {
      model: validatedRequest.model, // Use the model from request (should be 'casperhansen/llama-3.3-70b-instruct-awq')
      messages: o3cMessages,
      max_completion_tokens: validatedRequest.max_completion_tokens || 2000,
      temperature: validatedRequest.temperature,
      top_p: validatedRequest.top_p,
      stream: validatedRequest.stream
    };

    console.log('Making request to O3C API:', o3cRequestBody);

    // Use o3cChatAPI instance to make the request
    if (validatedRequest.stream) {
      return handleO3CStreaming(o3cRequestBody, userId);
    } else {
      const o3cResponse = await o3cChatAPI.createChatCompletion(o3cRequestBody);
      
      // Calculate costs based on response
      const inputTokens = o3cResponse.usage.prompt_tokens || Math.ceil(JSON.stringify(validatedRequest.messages).length / 4);
      const outputTokens = o3cResponse.usage.completion_tokens || 50;
      const creditCost = calculateCost('casperhansen/llama-3.3-70b-instruct-awq', inputTokens, outputTokens);
      
      // Charge credits
      const chargeSuccess = await chargeForUsage('casperhansen/llama-3.3-70b-instruct-awq', inputTokens, outputTokens, userId);
      if (!chargeSuccess) {
        console.error('Failed to charge credits for O3C API usage');
        return null;
      }

      const userCredits = await getUserCredits(userId);
      
      return NextResponse.json({
        ...o3cResponse,
        pricing: {
          credits_charged: creditCost,
          credits_remaining: userCredits - creditCost, // Full precision, no rounding
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
        processing_source: 'o3c',
        fallback_used: false,
      });
    }
    
  } catch (error) {
    if (error instanceof Error && error.message.includes('O3C_BAILOUT')) {
      console.log('🔄 BAILOUT: O3C bailout detected, returning null for OpenRouter fallback');
      return null;
    }
    console.error('Error calling O3C external API:', error);
    return null;
  }
}

// Handle O3C streaming
async function handleO3CStreaming(
  request: any,
  userId: string
): Promise<NextResponse> {
  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let totalOutputTokens = 0;
      let estimatedInputTokens = Math.ceil(JSON.stringify(request.messages).length / 4);

      try {
        await o3cChatAPI.createStreamingChatCompletion(
          request,
          (chunk) => {
            // Count output tokens (rough estimation)
            if (chunk.choices?.[0]?.delta?.content) {
              totalOutputTokens += Math.ceil(chunk.choices[0].delta.content.length / 4);
            }
            
            // Filter out end-of-text tokens from streaming content
            if (chunk.choices?.[0]?.delta?.content) {
              chunk.choices[0].delta.content = chunk.choices[0].delta.content
                .replace(/<\|eot_id\|>/g, '')
                .replace(/<\|end\|>/g, '')
                .replace(/<\|endoftext\|>/g, '');
            }
            
            // Forward chunk to client with processing source indicator
            const enhancedChunk = {
              ...chunk,
              processing_source: 'o3c',
              fallback_used: false,
            };
            
            const data = `data: ${JSON.stringify(enhancedChunk)}\n\n`;
            controller.enqueue(encoder.encode(data));
          },
          (error) => {
            console.error('O3C streaming error:', error);
            const errorData = `data: ${JSON.stringify({ error: error.message })}\n\n`;
            controller.enqueue(encoder.encode(errorData));
            controller.close();
          }
        );

        // Send completion message
        const completionData = `data: [DONE]\n\n`;
        controller.enqueue(encoder.encode(completionData));
        controller.close();

        // Charge credits after streaming is complete
        const creditCost = calculateCost('casperhansen/llama-3.3-70b-instruct-awq', estimatedInputTokens, totalOutputTokens);
        await chargeForUsage('casperhansen/llama-3.3-70b-instruct-awq', estimatedInputTokens, totalOutputTokens, userId);
        
      } catch (error) {
        console.error('O3C streaming setup error:', error);
        const errorData = `data: ${JSON.stringify({ 
          error: 'O3C streaming failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        })}\n\n`;
        controller.enqueue(encoder.encode(errorData));
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// Handle OpenRouter request
async function handleOpenRouterRequest(
  validatedRequest: any,
  userId: string,
  isStreaming: boolean
): Promise<NextResponse> {
  // Estimate tokens for credit checking
  const inputTokens = Math.ceil(JSON.stringify(validatedRequest.messages).length / 4);
  const estimatedOutputTokens = validatedRequest.max_completion_tokens || 150;
  
  // Use OpenRouter pricing for Llama 3.3 70B (approximate)
  const estimatedCreditCost = calculateCost('meta-llama/llama-3.3-70b-instruct', inputTokens, estimatedOutputTokens);
  const userCredits = await getUserCredits(userId);
  
  if (userCredits < estimatedCreditCost) {
    return NextResponse.json(
      { 
        error: `Insufficient credits. Estimated required: $${estimatedCreditCost.toFixed(4)}, Available: $${userCredits.toFixed(4)}`,
        credits_required: estimatedCreditCost,
        credits_available: userCredits,
      },
      { status: 402 }
    );
  }

  // Use the correct model ID for OpenRouter
  const openRouterRequest = {
    ...validatedRequest,
    model: 'meta-llama/llama-3.3-70b-instruct',
  };

  if (isStreaming) {
    return handleOpenRouterStreaming(openRouterRequest, userId, inputTokens);
  } else {
    return handleOpenRouterNonStreaming(openRouterRequest, userId, inputTokens);
  }
}

async function handleOpenRouterNonStreaming(
  request: any,
  userId: string,
  estimatedInputTokens: number
): Promise<NextResponse> {
  try {
    const response = await externalChatAPI.createChatCompletion(request);
    
    // Calculate actual costs based on response
    const actualInputTokens = response.usage.prompt_tokens || estimatedInputTokens;
    const actualOutputTokens = response.usage.completion_tokens || 50;
    const actualCreditCost = calculateCost('meta-llama/llama-3.3-70b-instruct', actualInputTokens, actualOutputTokens);
    
    // Charge credits based on actual usage
    const chargeSuccess = await chargeForUsage('meta-llama/llama-3.3-70b-instruct', actualInputTokens, actualOutputTokens, userId);
    
    if (!chargeSuccess) {
      return NextResponse.json(
        { error: 'Failed to charge credits' },
        { status: 500 }
      );
    }

    const userCredits = await getUserCredits(userId);

    // Return response with pricing info
    const enhancedResponse = {
      ...response,
      pricing: {
        credits_charged: actualCreditCost,
        credits_remaining: userCredits - actualCreditCost, // Full precision, no rounding
        input_tokens: actualInputTokens,
        output_tokens: actualOutputTokens,
      },
      processing_source: 'openrouter',
      fallback_used: true,
    };

    return NextResponse.json(enhancedResponse);
    
  } catch (error) {
    console.error('OpenRouter API error:', error);
    throw error;
  }
}

async function handleOpenRouterStreaming(
  request: any,
  userId: string,
  estimatedInputTokens: number
): Promise<NextResponse> {
  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let totalOutputTokens = 0;

      try {
        await externalChatAPI.createStreamingChatCompletion(
          request,
          (chunk) => {
            // Count output tokens (rough estimation)
            if (chunk.choices?.[0]?.delta?.content) {
              totalOutputTokens += Math.ceil(chunk.choices[0].delta.content.length / 4);
            }
            
            // Forward chunk to client with fallback indicator
            const enhancedChunk = {
              ...chunk,
              processing_source: 'openrouter',
              fallback_used: true,
            };
            
            const data = `data: ${JSON.stringify(enhancedChunk)}\n\n`;
            controller.enqueue(encoder.encode(data));
          },
          (error) => {
            console.error('OpenRouter streaming error:', error);
            const errorData = `data: ${JSON.stringify({ error: error.message })}\n\n`;
            controller.enqueue(encoder.encode(errorData));
            controller.close();
          }
        );

        // Send completion message
        const completionData = `data: [DONE]\n\n`;
        controller.enqueue(encoder.encode(completionData));
        controller.close();

        // Charge credits after streaming is complete
        const actualCreditCost = calculateCost('meta-llama/llama-3.3-70b-instruct', estimatedInputTokens, totalOutputTokens);
        await chargeForUsage('meta-llama/llama-3.3-70b-instruct', estimatedInputTokens, totalOutputTokens, userId);
        
      } catch (error) {
        console.error('OpenRouter streaming setup error:', error);
        const errorData = `data: ${JSON.stringify({ 
          error: 'OpenRouter streaming failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        })}\n\n`;
        controller.enqueue(encoder.encode(errorData));
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}