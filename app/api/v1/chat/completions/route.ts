import { NextRequest, NextResponse } from 'next/server';
import { validateAPIKey, getUserCredits, deductCredits, addTransaction } from '@/lib/credits';
import { getModelById, calculateCost } from '@/config/models';
import { getModelEndpoint } from '@/config/model-endpoints';
import { o3cClient, mapModelToOpenRouter } from '@/lib/o3c-client';
import { openRouterClient } from '@/lib/openrouter-client';

3// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Handle OPTIONS request for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { 
    status: 200,
    headers: corsHeaders
  });
}

export async function POST(request: NextRequest) {
  try {
    // Extract API key from Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header. Use: Authorization: Bearer YOUR_API_KEY' },
        { status: 401, headers: corsHeaders }
      );
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Validate API key
    const validation = await validateAPIKey(apiKey);
    if (!validation.valid || !validation.userId) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401, headers: corsHeaders }
      );
    }

    const userId = validation.userId;

    // Parse request body
    const body = await request.json();
    const { 
      model, 
      messages, 
      stream = false,
      max_completion_tokens
    } = body;
    
    // HARD CAP: Check user's request BEFORE capping it
    if (max_completion_tokens && max_completion_tokens > 2000) {
      return NextResponse.json(
        { error: 'max_completion_tokens cannot exceed 2000 tokens' },
        { status: 400, headers: corsHeaders }
      );
    }
    
    // Cap at 2000 for actual usage
    const maxTokens = Math.min(max_completion_tokens || 2000, 2000);

    if (!model || !messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Missing required fields: model and messages array' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Get the model info
    const modelInfo = getModelById(model);
    if (!modelInfo) {
      const availableModels = ['casperhansen/deepseek-r1-distill-llama-70b-awq', 'Qwen/Qwen3-32B-AWQ', 'btbtyler09/Devstral-Small-2507-AWQ', 'casperhansen/llama-3.3-70b-instruct-awq'];
      return NextResponse.json(
        { error: `Model '${model}' not found. Available models: ${availableModels.join(', ')}` },
        { status: 404, headers: corsHeaders }
      );
    }

    // Get the model endpoint configuration
    const endpointConfig = getModelEndpoint(model);
    if (!endpointConfig) {
      return NextResponse.json(
        { error: `Model '${model}' is not configured with an endpoint` },
        { status: 500, headers: corsHeaders }
      );
    }

    // Use model-specific chat defaults, allow user to override
    const modelDefaults = endpointConfig.requestParams;
    const requestParams = {
      temperature: body.temperature ?? modelDefaults.temperature,
      top_p: body.top_p ?? modelDefaults.top_p,
      top_k: body.top_k ?? modelDefaults.top_k,
      min_p: body.min_p ?? modelDefaults.min_p,
      max_completion_tokens: maxTokens, // Always use capped value
      // Include any other model-specific params (like eos_token_id)
      ...Object.fromEntries(
        Object.entries(modelDefaults).filter(([key]) => 
          !['temperature', 'top_p', 'top_k', 'min_p', 'max_completion_tokens'].includes(key)
        )
      )
    };

    // Prepare messages for the backend request
    let backendMessages = [...messages];
    
    // Add system prompt if specified in endpoint config and not already present
    if (endpointConfig.systemPrompt) {
      const hasSystemMessage = backendMessages.some(msg => msg.role === 'system');
      if (!hasSystemMessage) {
        backendMessages = [{ role: 'system', content: endpointConfig.systemPrompt }, ...backendMessages];
      }
    }

    // Prepare the request for the backend
    const backendRequest = {
      model: model,
      messages: backendMessages,
      stream: stream,
      ...requestParams
    };

    // Calculate estimated input tokens for cost calculation (rough estimate: ~4 characters per token)
    const inputText = JSON.stringify(backendMessages);
    const estimatedInputTokens = Math.ceil(inputText.length / 4);

    // Check user balance with estimated minimum cost
    const userBalance = await getUserCredits(userId);
    const minEstimatedCost = calculateCost(model, estimatedInputTokens, 10); // Estimate minimum 10 output tokens
    
    if (userBalance < minEstimatedCost) {
      return NextResponse.json(
        { 
          error: `Insufficient credits. Minimum required: $${minEstimatedCost.toFixed(4)}, Available: $${userBalance.toFixed(4)}`,
          required_credits: minEstimatedCost,
          available_credits: userBalance,
          token_breakdown: {
            estimated_input_tokens: estimatedInputTokens,
            estimated_min_output_tokens: 10,
            input_price_per_1m: modelInfo.input_price_per_1m,
            output_price_per_1m: modelInfo.output_price_per_1m,
            estimated_min_cost: minEstimatedCost
          }
        },
        { status: 402, headers: corsHeaders } // Payment Required
      );
    }

    let actualInputTokens = estimatedInputTokens;
    let actualOutputTokens = 0;
    let backendUsed = 'o3c';
    let responseContent = '';
    
    try {
      // Try O3C backend first with model-specific defaults (capped at 2000)
      const o3cRequest = {
        model_name: model,
        input_text: JSON.stringify(backendMessages),
        max_tokens: maxTokens,
        messages: backendMessages,
      };

      console.log('🔧 Trying O3C backend for model:', model);

      if (stream) {
        // Streaming response with fallback logic and proper abort handling
        const encoder = new TextEncoder();
        
        const stream = new ReadableStream({
          async start(controller) {
            // Create abort controller to handle client disconnection
            const streamController = new AbortController();
            let streamActive = true;
            
            // Helper function to safely enqueue data
            const safeEnqueue = (data: Uint8Array) => {
              if (!streamActive) return false;
              try {
                controller.enqueue(data);
                return true;
              } catch (error) {
                console.log('🛑 Client disconnected, stopping stream');
                streamActive = false;
                streamController.abort();
                return false;
              }
            };
            
            try {
              // Try O3C first - 6 second bailout
              const o3cResponse = await o3cClient.inferStreamingWithTimeout(
                o3cRequest, 
                (content: string) => {
                  if (!streamActive || streamController.signal.aborted) return;
                  
                  responseContent += content;
                  
                  // Send OpenAI-compatible chunk
                  const chunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [{
                      index: 0,
                      delta: {
                        content: content
                      }
                    }]
                  };
                  const chunkLine = `data: ${JSON.stringify(chunk)}\n\n`;
                  safeEnqueue(encoder.encode(chunkLine));
                },
                600000, // 10 minute max (no artificial timeout)
                streamController.signal // Pass abort signal to o3c client
              );
              
              if (o3cResponse && o3cResponse.result && streamActive) {
                actualOutputTokens = Math.ceil(responseContent.length / 4);
                backendUsed = 'o3c';
                console.log('✅ O3C streaming successful');
              }
            } catch (o3cError) {
              if (streamController.signal.aborted) {
                console.log('🛑 Stream was cancelled by client');
                return; // Don't fallback if user cancelled
              }
              
              console.error('❌ O3C failed, falling back to OpenRouter:', o3cError);
              
              // Fallback to OpenRouter only if stream is still active
              if (streamActive) {
                try {
                  const openRouterModel = mapModelToOpenRouter(model);
                  const openRouterRequest = {
                    model: openRouterModel,
                    messages: backendMessages,
                    max_tokens: maxTokens, // Use user's capped value (max 2000)
                    temperature: requestParams.temperature,
                    top_p: requestParams.top_p,
                    top_k: requestParams.top_k,
                    min_p: requestParams.min_p
                  };
                  
                  // Use REAL OpenRouter streaming (no more fake streaming!)
                  await openRouterClient.chatStreamWithTimeout(
                    openRouterRequest,
                    (content: string) => {
                      if (!streamActive || streamController.signal.aborted) return;
                      
                      responseContent += content;
                      
                      // Send real-time chunk
                      const chunk = {
                        id: `chatcmpl-${Date.now()}`,
                        object: 'chat.completion.chunk', 
                        created: Math.floor(Date.now() / 1000),
                        model: model,
                        choices: [{
                          index: 0,
                          delta: {
                            content: content
                          }
                        }]
                      };
                      const chunkLine = `data: ${JSON.stringify(chunk)}\n\n`;
                      safeEnqueue(encoder.encode(chunkLine));
                    },
                    60000
                  );
                  
                  actualOutputTokens = Math.ceil(responseContent.length / 4);
                  backendUsed = 'openrouter';
                  console.log('✅ OpenRouter streaming fallback successful (REAL streaming)');
                } catch (fallbackError) {
                  if (!streamController.signal.aborted) {
                    console.error('❌ Both O3C and OpenRouter failed:', fallbackError);
                    controller.error(fallbackError);
                  }
                  return;
                }
              }
            }
            
            // Send final chunk only if stream is still active
            if (streamActive && !streamController.signal.aborted) {
              safeEnqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              
              // Calculate and charge for usage
              const actualCost = calculateCost(model, actualInputTokens, actualOutputTokens);
              await deductCredits(userId, actualCost);
              await addTransaction(userId, {
                type: 'usage_charge',
                amount: -actualCost,
                description: `${modelInfo.name} - ${actualInputTokens + actualOutputTokens} tokens (streaming, ${backendUsed})`,
                status: 'completed',
                metadata: {
                  model,
                  input_tokens: actualInputTokens,
                  output_tokens: actualOutputTokens,
                  total_tokens: actualInputTokens + actualOutputTokens,
                  streaming: true,
                  backend: backendUsed
                }
              });
            }
          },
          
          cancel() {
            console.log('🛑 Stream cancelled by client');
            // This is called when client disconnects/aborts
          }
        });

        return new NextResponse(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      } else {
        // Non-streaming response with fallback logic - NO EXPLICIT TIMEOUTS
        try {
          // Try O3C first - let bailout logic handle timeouts naturally  
          const o3cResponse = await o3cClient.inferWithTimeout(o3cRequest, 600000); // 10 minutes max
          
          if (o3cResponse && o3cResponse.result) {
            responseContent = o3cResponse.result;
            actualOutputTokens = Math.ceil(responseContent.length / 4);
            backendUsed = 'o3c';
            console.log('✅ O3C non-streaming successful');
          }
        } catch (o3cError) {
          console.error('❌ O3C failed, falling back to OpenRouter:', o3cError);
          
          // Fallback to OpenRouter
          try {
            const openRouterModel = mapModelToOpenRouter(model);
            const openRouterRequest = {
              model: openRouterModel,
              messages: backendMessages,
              max_tokens: maxTokens, // Use user's capped value (max 2000)
              temperature: requestParams.temperature,
              top_p: requestParams.top_p,
              top_k: requestParams.top_k,
              min_p: requestParams.min_p
            };
            
            const openRouterResponse = await openRouterClient.chatWithTimeout(openRouterRequest, 60000); // 1 minute for OpenRouter
            
            if (openRouterResponse && openRouterResponse.choices?.[0]) {
              responseContent = openRouterResponse.choices[0].message.content || '';
              actualOutputTokens = openRouterResponse.usage?.completion_tokens || Math.ceil(responseContent.length / 4);
              actualInputTokens = openRouterResponse.usage?.prompt_tokens || actualInputTokens;
              backendUsed = 'openrouter';
              console.log('✅ OpenRouter non-streaming fallback successful');
            }
          } catch (fallbackError) {
            console.error('❌ Both O3C and OpenRouter failed:', fallbackError);
            return NextResponse.json(
              { error: 'Both primary and fallback services failed' },
              { status: 502, headers: corsHeaders }
            );
          }
        }
        
        const totalTokens = actualInputTokens + actualOutputTokens;
        
        // Calculate actual cost
        const actualCost = calculateCost(model, actualInputTokens, actualOutputTokens);
        
        // Charge user for actual usage
        const chargeSuccess = await deductCredits(userId, actualCost);
        if (!chargeSuccess) {
          return NextResponse.json(
            { error: 'Failed to charge credits' },
            { status: 500, headers: corsHeaders }
          );
        }
        
        // Add transaction record
        await addTransaction(userId, {
          type: 'usage_charge',
          amount: -actualCost,
          description: `${modelInfo.name} - ${totalTokens} tokens (${backendUsed})`,
          status: 'completed',
          metadata: {
            model,
            input_tokens: actualInputTokens,
            output_tokens: actualOutputTokens,
            total_tokens: totalTokens,
            backend: backendUsed
          }
        });
        
        // Return OpenAI-compatible non-streaming response
        const result = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: responseContent,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: actualInputTokens,
            completion_tokens: actualOutputTokens,
            total_tokens: totalTokens,
          },
          // O3C-specific billing info
          billing: {
            credits_charged: actualCost,
            credits_remaining: userBalance - actualCost,
            input_cost: (actualInputTokens / 1000000) * modelInfo.input_price_per_1m, // Full precision, no rounding
            output_cost: (actualOutputTokens / 1000000) * modelInfo.output_price_per_1m, // Full precision, no rounding
            pricing: {
              input_price_per_1m_tokens: modelInfo.input_price_per_1m,
              output_price_per_1m_tokens: modelInfo.output_price_per_1m,
            },
          },
          model_info: {
            provider: modelInfo.provider,
            context_length: modelInfo.context_length,
            capabilities: modelInfo.capabilities,
            max_tokens: modelInfo.max_tokens
          }
        };
        
        return NextResponse.json(result, { headers: corsHeaders });
      }
    } catch (error) {
      console.error('Error calling backend API:', error);
      return NextResponse.json(
        { error: 'Failed to communicate with backend API' },
        { status: 502, headers: corsHeaders }
      );
    }

  } catch (error) {
    console.error('Error in /api/v1/chat/completions:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
