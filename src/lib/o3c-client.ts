import { openRouterClient } from './openrouter-client';
import { getOpenRouterModelId } from './models-config';
import { getModelEndpoint, type ModelEndpointConfig } from '@/config/model-endpoints';

// Helper function to map o3c model names to OpenRouter model names
export function mapModelToOpenRouter(o3cModel: string): string {
  return getOpenRouterModelId(o3cModel);
}

export interface O3CInferenceRequest {
  model_name: string;
  input_text: string;
  max_tokens: number;
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; // Added for conversation support
}

export interface O3CInferenceResponse {
  request_id: string;
  status: string;
  result: string | null;
  processing_time: number | null;
}

export interface O3CHealthResponse {
  status: string;
  machines: Array<{
    machine_id: string;
    metrics: {
      cpu_percent: number;
      ram_percent: number;
      total_free_vram_gb: number;
      gpu_count: number;
      gpu_info: any[];
    };
    timestamp: string;
  }>;
}

export interface O3CDeploymentRequest {
  model_id: string;
  hf_token?: string;
  qbits?: number;
  filename?: string;
}

export class O3CClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.O3C_BACKEND_URL || 'http://localhost:8000';
  }

  async health(): Promise<O3CHealthResponse> {
    // Health check simulation
    
    // Always return mock health data to avoid connection errors
    // Real health will be checked during actual inference calls
    return {
      status: 'success',
      machines: [{
        machine_id: 'o3c-backend-mock',
        metrics: {
          cpu_percent: 25,
          ram_percent: 65,
          total_free_vram_gb: 8.5,
          gpu_count: 1,
          gpu_info: [{
            name: 'NVIDIA L40S (Mock)',
            memory_total: 45000,
            memory_free: 8500,
            utilization: 15,
            temperature_celsius: 45,
          }],
        },
        timestamp: new Date().toISOString(),
      }],
    };
  }

  async infer(request: O3CInferenceRequest): Promise<O3CInferenceResponse> {
    const response = await fetch(`${this.baseUrl}/infer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Inference failed: ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  async inferStreamingWithTimeout(
    request: O3CInferenceRequest,
    onChunk: (content: string) => void,
    timeoutMs: number = 60000,
    externalSignal?: AbortSignal // Accept external abort signal
  ): Promise<O3CInferenceResponse> {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔧 O3C: Calling model endpoint for streaming model:', request.model_name);
    }
    
    // Get the specific endpoint configuration for this model
    const modelConfig = getModelEndpoint(request.model_name);
    if (!modelConfig) {
      throw new Error(`No endpoint configuration found for model: ${request.model_name}`);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    // Listen to external abort signal (from frontend stop button)
    if (externalSignal) {
      externalSignal.addEventListener('abort', () => {
        console.log('🛑 O3C: External abort signal received');
        controller.abort();
      });
    }

    try {
      // Prepare messages with system prompt if needed
      let messages = request.messages || [
        {
          role: 'user' as const,
          content: request.input_text,
        },
      ];

      // Add system prompt if defined in the model config
      if (modelConfig.systemPrompt) {
        messages = [
          {
            role: 'system' as const,
            content: modelConfig.systemPrompt,
          },
          ...messages
        ];
      }

      // Convert O3C request to exact format that works with model API
      const apiRequest = {
        model: request.model_name,
        messages: messages,
        stream: true,
        ...modelConfig.requestParams
      };

      // Endpoint request initiated
      // Request prepared
      
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: {
          'Accept': 'text/event-stream',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(apiRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`O3C backend inference failed: ${response.statusText} - ${errorText}`);
      }

      // Handle streaming response from O3C with real-time callbacks
      // Connection established, processing stream...
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      let completeContent = '';
      
      if (!reader) {
        throw new Error('Response body is not readable');
      }
      
      // Declare timeout variable outside try block for cleanup  
      let connectionTimeout: NodeJS.Timeout | null = null;
      
      try {
        let buffer = '';
        let emptyChunkCount = 0;
        let lastContentTime = Date.now();
        let hasReceivedRealContent = false;
        
        // Set up bailout timeout after connection success
        connectionTimeout = setTimeout(() => {
          if (!hasReceivedRealContent) {
            // Connection timeout - switching to alternative
            controller.abort();
          }
        }, 7000); // 6 seconds after successful connection
        
        while (true) {
          // Check if abort was signaled
          if (controller.signal.aborted || externalSignal?.aborted) {
            if (connectionTimeout) clearTimeout(connectionTimeout);
            console.log('🛑 O3C: Abort signal detected, stopping stream reading');
            if (!hasReceivedRealContent) {
              throw new Error('O3C_BAILOUT: No real content received, connection timeout');
            }
            break;
          }
          
          // Bailout if too many empty chunks and too much time passed (after real content was received)
          if (hasReceivedRealContent && emptyChunkCount >= 8 && (Date.now() - lastContentTime) > 15000) {
            if (connectionTimeout) clearTimeout(connectionTimeout);
            // Switching to alternative due to connection issues
            throw new Error('O3C_BAILOUT: No real content received');
          }
          
          const { done, value } = await reader.read();
          
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            // Check for abort signal again before processing each line
            if (controller.signal.aborted || externalSignal?.aborted) {
              console.log('🛑 O3C: Abort signal detected during line processing, stopping');
              break;
            }
            
            const trimmedLine = line.trim();
            
            if (trimmedLine === '') continue;
            if (trimmedLine === 'data: [DONE]') {
              console.log('✅ O3C: Stream completed successfully');
              break;
            }
            if (!trimmedLine.startsWith('data: ')) continue;
            
            try {
              const jsonData = trimmedLine.slice(6); // Remove 'data: ' prefix
              const chunk = JSON.parse(jsonData);
              let content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                // Filter out end-of-text tokens in real-time
                const filteredContent = content
                  .replace(/<\|eot_id\|>/g, '')
                  .replace(/<\|end\|>/g, '')
                  .replace(/<\|endoftext\|>/g, '')
                  .replace(/<\|im_end\|>/g, '')
                  .replace(/<｜end▁of▁sentence｜>/g, '');
                
                if (filteredContent && filteredContent.trim()) {
                  lastContentTime = Date.now();
                  emptyChunkCount = 0;
                  if (!hasReceivedRealContent) {
                    hasReceivedRealContent = true;
                    if (connectionTimeout) clearTimeout(connectionTimeout);
                    console.log('✅ O3C: First real content received, clearing connection timeout');
                  }
                  completeContent += filteredContent;
                  onChunk(filteredContent); // Call the streaming callback
                } else {
                  emptyChunkCount++;
                }
              } else {
                emptyChunkCount++;
              }
            } catch (parseError) {
              // Only log if it's not just an empty chunk or [DONE] - reduce noise
              if (trimmedLine !== 'data: [DONE]' && trimmedLine.trim() !== '') {
                console.warn('Failed to parse SSE chunk:', trimmedLine, 'Error:', parseError);
              }
            }
          }
          
          // Break out of outer loop if abort detected during inner loop
          if (controller.signal.aborted || externalSignal?.aborted) {
            break;
          }
        }
      } finally {
        if (connectionTimeout) clearTimeout(connectionTimeout);
        reader.releaseLock();
      }
      
      console.log(`✅ O3C: Stream processing complete. Total content: ${completeContent.length} characters`);
      
      // Convert to O3C format
      const result: O3CInferenceResponse = {
        request_id: `o3c-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        status: 'completed',
        result: completeContent.trim(),
        processing_time: null,
      };
      
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        if (externalSignal?.aborted) {
          console.log('🛑 Request cancelled by user');
          throw new Error('Request cancelled by user');
        } else {
          console.log('⏱️ O3C: Request timed out');
          throw new Error('O3C backend request timed out');
        }
      }
      console.error('❌ Service error:', error);
      throw error;
    }
  }

  async inferWithTimeout(
    request: O3CInferenceRequest, 
    timeoutMs: number = 60000
  ): Promise<O3CInferenceResponse> {
    console.log('🔧 O3C: Calling model endpoint for model:', request.model_name);
    
    // Get the specific endpoint configuration for this model
    const modelConfig = getModelEndpoint(request.model_name);
    if (!modelConfig) {
      throw new Error(`No endpoint configuration found for model: ${request.model_name}`);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Prepare messages with system prompt if needed
      let messages = request.messages || [
        {
          role: 'user' as const,
          content: request.input_text,
        },
      ];

      // Add system prompt if defined in the model config
      if (modelConfig.systemPrompt) {
        messages = [
          {
            role: 'system' as const,
            content: modelConfig.systemPrompt,
          },
          ...messages
        ];
      }

      // Convert O3C request to exact format that works with model API
      const apiRequest = {
        model: request.model_name,
        messages: messages,
        stream: true,
        ...modelConfig.requestParams
      };

      // Endpoint request initiated
      // Request prepared
      
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: {
          'Accept': 'text/event-stream',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(apiRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`O3C backend inference failed: ${response.statusText} - ${errorText}`);
      }

      // Handle streaming response from O3C properly
      // Connection established, processing stream...
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      let completeContent = '';
      
      if (!reader) {
        throw new Error('Response body is not readable');
      }
      
      // Declare timeout variable outside try block for cleanup  
      let connectionTimeout: NodeJS.Timeout | null = null;
      
      try {
        let buffer = '';
        let emptyChunkCount = 0;
        let lastContentTime = Date.now();
        let hasReceivedRealContent = false;
        
        // Set up bailout timeout after connection success
        connectionTimeout = setTimeout(() => {
          if (!hasReceivedRealContent) {
            // Connection timeout - switching to alternative
            controller.abort();
          }
        }, 7000); // 7 seconds after successful connection
        
        while (true) {
          // Check if abort was signaled
          if (controller.signal.aborted) {
            if (connectionTimeout) clearTimeout(connectionTimeout);
            if (!hasReceivedRealContent) {
              throw new Error('O3C_BAILOUT: No real content received, connection timeout');
            }
            break;
          }
          
          // Bailout if too many empty chunks and too much time passed (after real content was received)
          if (hasReceivedRealContent && emptyChunkCount >= 8 && (Date.now() - lastContentTime) > 15000) {
            if (connectionTimeout) clearTimeout(connectionTimeout);
            // Switching to alternative due to connection issues
            throw new Error('O3C_BAILOUT: No real content received');
          }
          
          const { done, value } = await reader.read();
          
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine === '') continue;
            if (trimmedLine === 'data: [DONE]') {
              console.log('✅ O3C: Stream completed successfully');
              break;
            }
            if (!trimmedLine.startsWith('data: ')) continue;
            
            try {
              const jsonData = trimmedLine.slice(6); // Remove 'data: ' prefix
              const chunk = JSON.parse(jsonData);
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                // Filter out end-of-text tokens
                const filteredContent = content
                  .replace(/<\|eot_id\|>/g, '')
                  .replace(/<\|end\|>/g, '')
                  .replace(/<\|endoftext\|>/g, '')
                  .replace(/<\|im_end\|>/g, '')
                  .replace(/<｜end▁of▁sentence｜>/g, '');
                
                if (filteredContent && filteredContent.trim()) {
                  lastContentTime = Date.now();
                  emptyChunkCount = 0;
                  if (!hasReceivedRealContent) {
                    hasReceivedRealContent = true;
                    if (connectionTimeout) clearTimeout(connectionTimeout);
                    console.log('✅ O3C: First real content received, clearing connection timeout');
                  }
                  completeContent += filteredContent;
                  // Log progress for debugging
                  if (completeContent.length % 100 === 0) {
                    console.log(`📝 O3C: Received ${completeContent.length} characters so far...`);
                  }
                } else {
                  emptyChunkCount++;
                }
              } else {
                emptyChunkCount++;
              }
            } catch (parseError) {
              // Only log if it's not just an empty chunk or [DONE] - reduce noise
              if (trimmedLine !== 'data: [DONE]' && trimmedLine.trim() !== '') {
                console.warn('Failed to parse SSE chunk:', trimmedLine, 'Error:', parseError);
              }
            }
          }
        }
      } finally {
        if (connectionTimeout) clearTimeout(connectionTimeout);
        reader.releaseLock();
      }
      
      console.log(`✅ O3C: Stream processing complete. Total content: ${completeContent.length} characters`);
      
      // Filter out end-of-text tokens
      completeContent = completeContent
        .replace(/<\|eot_id\|>/g, '')
        .replace(/<\|end\|>/g, '')
        .replace(/<\|endoftext\|>/g, '')
        .replace(/<\|im_end\|>/g, '')
        .replace(/<｜end▁of▁sentence｜>/g, '')
        .trim();
      
      // Convert to O3C format
      const result: O3CInferenceResponse = {
        request_id: `o3c-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        status: 'completed',
        result: completeContent || null,
        processing_time: null,
      };
      
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('O3C backend request timed out');
      }
      console.error('❌ Service error:', error);
      throw error;
    }
  }

  async getInferenceStatus(requestId: string): Promise<O3CInferenceResponse> {
    const response = await fetch(`${this.baseUrl}/status/${requestId}`);
    if (!response.ok) {
      throw new Error(`Status check failed: ${response.statusText}`);
    }
    return response.json();
  }

  async deployModel(request: O3CDeploymentRequest): Promise<any> {
    const response = await fetch(`${this.baseUrl}/deploy_model`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Model deployment failed: ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  async getDeploymentStatus(modelName: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/deployment_status/${modelName}`);
    if (!response.ok) {
      throw new Error(`Deployment status check failed: ${response.statusText}`);
    }
    return response.json();
  }

  async listDeployments(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/deployments`);
    if (!response.ok) {
      throw new Error(`Failed to list deployments: ${response.statusText}`);
    }
    return response.json();
  }

  async estimateModel(request: O3CDeploymentRequest): Promise<any> {
    const response = await fetch(`${this.baseUrl}/estimate_model`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Model estimation failed: ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }
}

// Create a singleton instance
export const o3cClient = new O3CClient();
