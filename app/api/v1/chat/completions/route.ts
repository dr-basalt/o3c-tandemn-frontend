import { NextRequest, NextResponse } from 'next/server';
import { validateAPIKey, getUserCredits, deductCredits, addTransaction, getLitellmVirtualKey } from '@/lib/credits';
import { getModelById, getAllModels, calculateCost } from '@/config/models';
import { getModelEndpoint } from '@/config/model-endpoints';
import { tandemnClient, mapModelToOpenRouter } from '@/lib/tandemn-client';
import { OpenRouterClient, openRouterClient } from '@/lib/openrouter-client';

// CORS headers
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

    // Resolve user's litellm virtual key for per-user spend tracking
    const userLitellmKey = await getLitellmVirtualKey(userId);
    // Use user's virtual key when available, otherwise fall back to shared key
    const userOpenRouterClient = userLitellmKey
      ? new OpenRouterClient(userLitellmKey)
      : openRouterClient;

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

    // Get the model info — tolère les modèles inconnus (litellm les valide en aval)
    const modelInfo = getModelById(model);

    // Branded models (o3c-*) + embedding-pro → routing via litellm (pas de direct endpoint requis)
    const isLitellmModel = modelInfo?.routing === 'litellm' || model.startsWith('o3c-') || model === 'embedding-pro';
    const endpointConfig = isLitellmModel ? null : getModelEndpoint(model);

    if (!isLitellmModel && !endpointConfig) {
      // Modèle inconnu ET pas branded → refuse
      const availableModels = getAllModels().map(m => m.id);
      return NextResponse.json(
        { error: `Model '${model}' not found. Available models: ${availableModels.join(', ')}` },
        { status: 404, headers: corsHeaders }
      );
    }

    // Prepare messages for the backend request
    let backendMessages = [...messages];

    // Add system prompt if specified in endpoint config and not already present
    if (endpointConfig?.systemPrompt) {
      const hasSystemMessage = backendMessages.some(msg => msg.role === 'system');
      if (!hasSystemMessage) {
        backendMessages = [{ role: 'system', content: endpointConfig.systemPrompt }, ...backendMessages];
      }
    }

    // Request params — litellm models use simple defaults, direct models use endpoint-specific params
    const requestParams = endpointConfig
      ? {
          temperature: body.temperature ?? endpointConfig.requestParams.temperature,
          top_p: body.top_p ?? endpointConfig.requestParams.top_p,
          top_k: body.top_k ?? endpointConfig.requestParams.top_k,
          min_p: body.min_p ?? endpointConfig.requestParams.min_p,
          max_completion_tokens: maxTokens,
          ...Object.fromEntries(
            Object.entries(endpointConfig.requestParams).filter(([key]) =>
              !['temperature', 'top_p', 'top_k', 'min_p', 'max_completion_tokens'].includes(key)
            )
          ),
        }
      : {
          temperature: body.temperature ?? 0.7,
          max_tokens: maxTokens,
        };

    // Prepare the request for the backend
    const backendRequest = {
      model: model,
      messages: backendMessages,
      stream: stream,
      ...requestParams,
    };

    // Calculate estimated input tokens for cost calculation (rough estimate: ~4 characters per token)
    const inputText = JSON.stringify(backendMessages);
    const estimatedInputTokens = Math.ceil(inputText.length / 4);

    // Check user balance with estimated minimum cost
    const userBalance = await getUserCredits(userId);
    const minEstimatedCost = calculateCost(model, estimatedInputTokens, 10);

    if (userBalance < minEstimatedCost) {
      return NextResponse.json(
        {
          error: `Insufficient credits. Minimum required: $${minEstimatedCost.toFixed(4)}, Available: $${userBalance.toFixed(4)}`,
          required_credits: minEstimatedCost,
          available_credits: userBalance,
          token_breakdown: {
            estimated_input_tokens: estimatedInputTokens,
            estimated_min_output_tokens: 10,
            input_price_per_1m: modelInfo?.input_price_per_1m ?? 0.025,
            output_price_per_1m: modelInfo?.output_price_per_1m ?? 0.07,
            estimated_min_cost: minEstimatedCost,
          },
        },
        { status: 402, headers: corsHeaders }
      );
    }

    let actualInputTokens = estimatedInputTokens;
    let actualOutputTokens = 0;
    let backendUsed = 'tandemn';
    let responseContent = '';
    
    try {
      // Try Tandemn backend first with model-specific defaults (capped at 2000)
      const tandemnRequest = {
        model_name: model,
        input_text: JSON.stringify(backendMessages),
        max_tokens: maxTokens,
        messages: backendMessages,
      };

      console.log('🔧 Trying Tandemn backend for model:', model);

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
            
            const doLitellmStream = async () => {
              const openRouterRequest = {
                model: model,
                messages: backendMessages,
                max_tokens: maxTokens,
                temperature: ((requestParams as Record<string, unknown>).temperature as number | undefined) ?? 0.7,
                stream: true,
              };
              await userOpenRouterClient.chatStreamWithTimeout(
                openRouterRequest,
                (content: string) => {
                  if (!streamActive || streamController.signal.aborted) return;
                  responseContent += content;
                  const chunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [{ index: 0, delta: { content } }],
                  };
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                },
                120000
              );
              actualOutputTokens = Math.ceil(responseContent.length / 4);
              backendUsed = 'litellm';
            };

            try {
              if (isLitellmModel) {
                // Branded models go directly to litellm — no direct AWS attempt
                await doLitellmStream();
                console.log('✅ litellm streaming successful for branded model:', model);
              } else {
                // Direct models: try tandemn first, fall back to litellm
                const tandemnResponse = await tandemnClient.inferStreamingWithTimeout(
                  tandemnRequest,
                  (content: string) => {
                    if (!streamActive || streamController.signal.aborted) return;
                    responseContent += content;
                    const chunk = {
                      id: `chatcmpl-${Date.now()}`,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: model,
                      choices: [{ index: 0, delta: { content } }],
                    };
                    safeEnqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  },
                  600000,
                  streamController.signal
                );
                if (tandemnResponse && tandemnResponse.result && streamActive) {
                  actualOutputTokens = Math.ceil(responseContent.length / 4);
                  backendUsed = 'tandemn';
                  console.log('✅ Tandemn streaming successful');
                }
              }
            } catch (primaryError) {
              if (streamController.signal.aborted) {
                console.log('🛑 Stream was cancelled by client');
                return;
              }
              console.error('❌ Primary backend failed, falling back to litellm:', primaryError);
              if (streamActive) {
                try {
                  await doLitellmStream();
                  console.log('✅ litellm fallback streaming successful');
                } catch (fallbackError) {
                  if (!streamController.signal.aborted) {
                    console.error('❌ Both backends failed:', fallbackError);
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
                description: `${modelInfo?.name ?? model} - ${actualInputTokens + actualOutputTokens} tokens (streaming, ${backendUsed})`,
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
          // Try Tandemn first - let bailout logic handle timeouts naturally  
          const tandemnResponse = await tandemnClient.inferWithTimeout(tandemnRequest, 600000); // 10 minutes max
          
          if (tandemnResponse && tandemnResponse.result) {
            responseContent = tandemnResponse.result;
            actualOutputTokens = Math.ceil(responseContent.length / 4);
            backendUsed = 'tandemn';
            console.log('✅ Tandemn non-streaming successful');
          }
        } catch (tandemnError) {
          console.error('❌ Tandemn failed, falling back to OpenRouter:', tandemnError);
          
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
            
            const openRouterResponse = await userOpenRouterClient.chatWithTimeout(openRouterRequest, 60000); // 1 minute for OpenRouter
            
            if (openRouterResponse && openRouterResponse.choices?.[0]) {
              responseContent = openRouterResponse.choices[0].message.content || '';
              actualOutputTokens = openRouterResponse.usage?.completion_tokens || Math.ceil(responseContent.length / 4);
              actualInputTokens = openRouterResponse.usage?.prompt_tokens || actualInputTokens;
              backendUsed = 'openrouter';
              console.log('✅ OpenRouter non-streaming fallback successful');
            }
          } catch (fallbackError) {
            console.error('❌ Both Tandemn and OpenRouter failed:', fallbackError);
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
          // Tandemn-specific billing info
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
