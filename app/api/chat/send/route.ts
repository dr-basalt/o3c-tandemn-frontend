import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/mock/db';
import { chatSendSchema } from '@/lib/zod-schemas';
import { chargeCredits, getUserCredits } from '@/lib/credits';
import { calculateCost } from '@/config/models';
import { sleep } from '@/lib/utils';
import { o3cClient, mapModelToOpenRouter } from '@/lib/o3c-client';
import { openRouterClient } from '@/lib/openrouter-client';
import { ChatResponseService } from '@/lib/services/chatResponseService';
import { ConversationService } from '@/lib/services/conversationService';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { modelId, roomId, messages } = chatSendSchema.parse(body);
    
    // Get the model to determine latency
    const model = db.getModelById(modelId);
    if (!model) {
      return NextResponse.json(
        { error: 'Model not found' },
        { status: 404 }
      );
    }

    // Calculate conversation text for token estimation
    const conversationText = messages.map(m => m.content).join(' ');
    
    // Check user credits for authenticated users (based on model pricing)
    const estimatedInputTokens = Math.ceil(conversationText.length / 4);
    const estimatedOutputTokens = Math.ceil(1024 / 4); // Assume max tokens for estimation (playground limit)
    const estimatedCost = calculateCost(model.id, estimatedInputTokens, estimatedOutputTokens);
    
    if (userId) {
      const userCredits = await getUserCredits(userId);
      
      if (userCredits < estimatedCost) {
        return NextResponse.json(
          { 
            error: `Insufficient credits. You need $${estimatedCost.toFixed(2)} but only have $${userCredits.toFixed(2)}. Please purchase more credits to continue.`,
            requiredCredits: estimatedCost,
            currentCredits: userCredits
          },
          { status: 402 } // Payment Required
        );
      }
    }
    
    // Store the user message in MongoDB with encryption
    if (roomId) {
      const userMessage = messages[messages.length - 1];
      if (userMessage && userMessage.role === 'user') {
        try {
          await ConversationService.addMessage(
            roomId,
            userId,
            'user',
            userMessage.content
          );
          console.log('💾 MongoDB: Saved user message with encryption');
        } catch (error) {
          console.error('❌ MongoDB: Failed to save user message:', error);
          // Don't fail the request if user message save fails - continue with response
        }
      }
    }

    // Calculate approximate token usage for the entire conversation  
    const inputTokens = Math.ceil(conversationText.length / 4); // Rough estimate: 4 chars per token
    const startTime = Date.now();
    
    // Create a ReadableStream for real-time SSE streaming
    const encoder = new TextEncoder();
    let response = '';
    let outputTokens = 0;
    let totalCost = 0;
    let backendUsed = 'mock';
    
    // Create abort signal that can be passed to the o3c client
    const streamController = new AbortController();
    
    const stream = new ReadableStream({
      async start(controller) {
        
        try {
          // Try o3c backend first with real-time streaming
          const o3cRequest = {
            model_name: model.id,
            input_text: conversationText,
            max_tokens: 1024, // Playground uses 1024, API uses 2000
            messages: messages, // Pass full conversation history
          };
          
          if (process.env.NODE_ENV === 'development') {
            console.log('🔧 API: Trying o3c backend with streaming for model:', model.id);
          }
          
          const o3cResponse = await o3cClient.inferStreamingWithTimeout(
            o3cRequest, 
            (content: string) => {
              // Real-time streaming callback - send content immediately
              response += content;
              const chunkData = { 
                text: content, 
                done: false,
                backend: 'o3c'
              };
              console.log('📤 API: Streaming chunk from o3c:', content.slice(0, 50) + '...');
              const chunk = `event: chunk\ndata: ${JSON.stringify(chunkData)}\n\n`;
              
              try {
                controller.enqueue(encoder.encode(chunk));
              } catch (error) {
                // Controller might be closed if client aborted
                if (error instanceof TypeError && error.message.includes('Controller is already closed')) {
                  console.log('🛑 API: Client disconnected, stopping o3c stream');
                  streamController.abort(); // Signal o3c backend to stop
                  return;
                }
                throw error;
              }
            },
            30000, // 30 second timeout - fail fast and fallback to OpenRouter
            streamController.signal // Pass abort signal to o3c client
          );
          
          if (o3cResponse && o3cResponse.result) {
            // Use the actual result from the real O3C backend
            outputTokens = Math.ceil(response.length / 4);
            backendUsed = 'o3c';
            if (process.env.NODE_ENV === 'development') {
              console.log('🔧 API: Setting backendUsed to o3c (real backend)');
            }
            
            // Calculate tokens and cost
            const totalTokens = inputTokens + outputTokens;
            
            // Calculate cost based on model pricing
            const inputCost = (inputTokens / 1000000) * model.promptPrice;
            const outputCost = (outputTokens / 1000000) * model.completionPrice;
            totalCost = inputCost + outputCost;
            
            // Store assistant message in MongoDB with encryption
            let newMessage: any = null;
            if (roomId) {
              try {
                const assistantMessage = await ConversationService.addMessage(
                  roomId,
                  userId,
                  'assistant',
                  response,
                  model.id,
                  {
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                    cost: totalCost,
                  },
                  {
                    backend: backendUsed as 'o3c' | 'openrouter' | 'mock',
                    processingTime: Date.now() - startTime,
                  }
                );
                newMessage = { id: assistantMessage.id };
                console.log('💾 MongoDB: Saved assistant message with encryption');
              } catch (error) {
                console.error('❌ MongoDB: Failed to save assistant message:', error);
                // Continue without failing the request
              }
            }

            // Save to database
            try {
              await ChatResponseService.createChatResponse({
                userId: userId,
                modelId: model.id,
                roomId: roomId || undefined,
                messageId: newMessage?.id,
                inputText: conversationText,
                responseText: response,
                backendUsed: backendUsed as 'o3c' | 'openrouter' | 'mock',
                inputTokens,
                outputTokens,
                totalTokens,
                inputCost,
                outputCost,
                totalCost,
                processingTimeMs: Date.now() - startTime,
                metadata: {
                  modelVendor: model.vendor,
                  modelName: model.name,
                  requestId: newMessage?.id,
                },
              });
              console.log('💾 Database: Saved chat response to MongoDB');
            } catch (error) {
              console.error('❌ Database: Failed to save chat response:', error);
            }
            
            // Track usage if user is authenticated
            if (userId) {
              const trackingUserId = userId === 'demo' ? 'demo-user' : userId;
              
              // Record usage in database
              db.addUsage({
                userId: trackingUserId,
                modelId: model.id,
                roomId: roomId || undefined,
                messageId: newMessage?.id,
                inputTokens,
                outputTokens,
                totalTokens,
                cost: totalCost,
              });
              
              // Charge credits based on actual token usage and model pricing
              const actualCost = calculateCost(model.id, inputTokens, outputTokens);
              await chargeCredits(actualCost, `${model.name}: ${inputTokens} input + ${outputTokens} output tokens`, userId, { 
                modelId: model.id, 
                roomId, 
                inputTokens, 
                outputTokens,
                backend: backendUsed,
                cost: actualCost
              });
            }
            
            // Send final chunk
            const finalChunkData = { 
              done: true,
              backend: backendUsed
            };
            // Backend info hidden from production logs
            const finalChunk = `event: chunk\ndata: ${JSON.stringify(finalChunkData)}\n\n`;
            controller.enqueue(encoder.encode(finalChunk));
            controller.close();
            return;
          }
        } catch (o3cError) {
          // Check if this is a user cancellation - if so, don't fallback to OpenRouter
          if (o3cError instanceof Error && o3cError.message === 'Request cancelled by user') {
            console.log('🛑 API: Request cancelled by user');
            // Just close the stream cleanly without fallback
            const cancelledChunk = `event: chunk\ndata: ${JSON.stringify({ 
              done: true, 
              backend: 'o3c',
              cancelled: true 
            })}\n\n`;
            controller.enqueue(encoder.encode(cancelledChunk));
            controller.close();
            return;
          }
          
          if (process.env.NODE_ENV === 'development') {
            console.error('❌ Primary service failed');
            console.error('Error details:', o3cError);
            console.error('Model attempted:', model.id);
            console.error('Conversation length:', messages.length, 'messages');
          }
          
          // Fallback to alternative provider when primary backend fails
          try {
            console.log('🔄 API: Falling back to OpenRouter...');
            const openRouterModel = mapModelToOpenRouter(model.id);
            console.log(`🔄 API: Using OpenRouter model: ${openRouterModel}`);
            
            const openRouterRequest = {
              model: openRouterModel,
              messages: messages,
              max_tokens: 1024, // Playground limit
              temperature: 0.7,
            };
            
            console.log('📡 API: Sending request to OpenRouter...');
            const openRouterResponse = await openRouterClient.chatWithTimeout(openRouterRequest, 60000); // Increased to 60s
            
            if (openRouterResponse && openRouterResponse.choices && openRouterResponse.choices[0]) {
              response = openRouterResponse.choices[0].message.content || '';
              outputTokens = openRouterResponse.usage?.completion_tokens || Math.ceil(response.length / 4);
              backendUsed = 'openrouter';
              console.log('✅ API: OpenRouter fallback successful, response length:', response.length);
              // Fallback successful
              
              // Send the OpenRouter response as streaming chunks (simulated)
              const words = response.split(' ');
              let currentIndex = 0;
              
              const sendFallbackChunk = async () => {
                // Check if controller is still open
                try {
                  if (currentIndex >= words.length) {
                    // Calculate costs for OpenRouter fallback
                    const totalTokens = inputTokens + outputTokens;
                    const inputCost = (inputTokens / 1000000) * (model.promptPrice || 0);
                    const outputCost = (outputTokens / 1000000) * (model.completionPrice || 0);
                    const totalCost = inputCost + outputCost;
                    const endTime = Date.now();
                    
                    // Store assistant message in MongoDB with encryption (OpenRouter fallback)
                    let newMessage: any = null;
                    if (roomId) {
                      try {
                        const assistantMessage = await ConversationService.addMessage(
                          roomId,
                          userId,
                          'assistant',
                          response,
                          model.id,
                          {
                            inputTokens,
                            outputTokens,
                            totalTokens: inputTokens + outputTokens,
                            cost: totalCost,
                          },
                          {
                            backend: 'openrouter',
                            processingTime: endTime - startTime,
                          }
                        );
                        newMessage = { id: assistantMessage.id };
                        console.log('💾 MongoDB: Saved OpenRouter fallback assistant message with encryption');
                      } catch (error) {
                        console.error('❌ MongoDB: Failed to save OpenRouter fallback assistant message:', error);
                        // Continue without failing the request
                      }
                    }
                    
                    // Save OpenRouter fallback to ChatResponse collection
                    try {
                      await ChatResponseService.createChatResponse({
                        userId: userId,
                        modelId: model.id,
                        roomId: roomId || undefined,
                        messageId: newMessage?.id,
                        inputText: conversationText,
                        responseText: response,
                        backendUsed: 'openrouter',
                        inputTokens,
                        outputTokens,
                        totalTokens,
                        inputCost,
                        outputCost,
                        totalCost,
                        processingTimeMs: endTime - startTime,
                        metadata: {
                          modelVendor: model.vendor,
                          modelName: model.name,
                          requestId: newMessage?.id,
                        },
                      });
                      console.log('💾 Database: Saved OpenRouter fallback chat response to MongoDB');
                    } catch (error) {
                      console.error('❌ Database: Failed to save OpenRouter chat response:', error);
                    }
                    
                    // Charge credits for OpenRouter fallback
                    if (userId) {
                      const trackingUserId = userId === 'demo' ? 'demo-user' : userId;
                      
                      // Record usage in database
                      db.addUsage({
                        userId: trackingUserId,
                        modelId: model.id,
                        roomId: roomId || undefined,
                        messageId: newMessage?.id,
                        inputTokens,
                        outputTokens,
                        totalTokens,
                        cost: totalCost,
                      });
                      
                      // Charge credits based on actual token usage and model pricing
                      const actualCost = calculateCost(model.id, inputTokens, outputTokens);
                      await chargeCredits(actualCost, `${model.name}: ${inputTokens} input + ${outputTokens} output tokens (OpenRouter fallback)`, userId, { 
                        modelId: model.id, 
                        roomId, 
                        inputTokens, 
                        outputTokens,
                        backend: 'openrouter',
                        cost: actualCost
                      });
                    }
                    
                    // Send final chunk for OpenRouter fallback
                    const finalChunkData = { 
                      done: true,
                      backend: backendUsed
                    };
                    // Send final chunk
                    const finalChunk = `event: chunk\ndata: ${JSON.stringify(finalChunkData)}\n\n`;
                    controller.enqueue(encoder.encode(finalChunk));
                    controller.close();
                    return;
                  }
                  
                  // Send word(s) - sometimes multiple words at once for variety
                  const wordsToSend = Math.random() > 0.7 ? 2 : 1;
                  const textChunk = words
                    .slice(currentIndex, currentIndex + wordsToSend)
                    .join(' ') + (currentIndex + wordsToSend < words.length ? ' ' : '');
                  
                  const chunkData = { 
                    text: textChunk, 
                    done: false,
                    backend: backendUsed
                  };
                  // Sending chunk
                  const chunk = `event: chunk\ndata: ${JSON.stringify(chunkData)}\n\n`;
                  
                  controller.enqueue(encoder.encode(chunk));
                  currentIndex += wordsToSend;
                  
                  // Use model's latency to pace the response
                  const delay = Math.max(50, model.latencyMs / words.length);
                  setTimeout(sendFallbackChunk, delay);
                } catch (error) {
                  // Controller is closed - stop sending chunks
                  if (error instanceof TypeError && error.message.includes('Controller is already closed')) {
                    // Client disconnected
                    return;
                  }
                  throw error;
                }
              };
              
              sendFallbackChunk();
              return;
              
            } else {
              throw new Error('OpenRouter returned empty response');
            }
          } catch (openRouterError) {
            console.error('❌ API: OpenRouter fallback also failed');
            console.error('OpenRouter error:', openRouterError);
            
            // Send generic error through the stream
            const errorChunk = `event: chunk\ndata: ${JSON.stringify({ 
              error: `Service temporarily unavailable. Both O3C and OpenRouter are down. Please try again in a moment.`,
              done: true
            })}\n\n`;
            controller.enqueue(encoder.encode(errorChunk));
            controller.close();
            return;
          }
        }
      },
      
      cancel() {
        console.log('🛑 API: ReadableStream cancelled by client');
        // This is called when the client aborts the request
        // We should signal any ongoing operations to stop
        if (streamController) {
          streamController.abort();
        }
      }
    });
    
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
    
  } catch (error) {
    console.error('Error in /api/chat/send:', error);
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}

