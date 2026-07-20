export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  stream: boolean;
  messages: ChatCompletionMessage[];
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  min_tokens?: number;
  seed?: number;
  frequency_penalty?: number;
  repetition_penalty?: number;
  presence_penalty?: number;
  n?: number;
  eos_token_id?: number[];
  stop?: string[];
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: 'stop' | 'length' | 'content_filter';
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamingChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
    };
    finish_reason?: 'stop' | 'length' | 'content_filter';
  }>;
}

const OPENROUTER_API_BASE_URL = process.env.OPENROUTER_API_BASE_URL || 'https://openrouter.ai/api/v1';
const TANDEM_API_BASE_URL = 'http://34.207.103.140:8000/v1';

export class ExternalChatAPI {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string = OPENROUTER_API_BASE_URL, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API request failed: ${response.status} ${response.statusText}. ${errorData.error || ''}`);
    }

    const result = await response.json();
    
    // Filter out end-of-text tokens from non-streaming responses
    if (result.choices?.[0]?.message?.content) {
      result.choices[0].message.content = result.choices[0].message.content
        .replace(/<\|eot_id\|>/g, '')
        .replace(/<\|end\|>/g, '')
        .replace(/<\|endoftext\|>/g, '')
        .trim();
    }
    
    return result;
  }

  async createStreamingChatCompletion(
    request: ChatCompletionRequest,
    onChunk: (chunk: StreamingChatCompletionChunk) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...request, stream: true }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(`API request failed: ${response.status} ${response.statusText}. ${errorData.error || ''}`);
      onError?.(error);
      throw error;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    try {
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          
          if (trimmedLine === '') continue;
          if (trimmedLine === 'data: [DONE]') return;
          if (!trimmedLine.startsWith('data: ')) continue;
          
          try {
            const jsonData = trimmedLine.slice(6); // Remove 'data: ' prefix
            const chunk = JSON.parse(jsonData) as StreamingChatCompletionChunk;
            
            // Filter out end-of-text tokens from streaming content
            if (chunk.choices?.[0]?.delta?.content) {
              chunk.choices[0].delta.content = chunk.choices[0].delta.content
                .replace(/<\|eot_id\|>/g, '')
                .replace(/<\|end\|>/g, '')
                .replace(/<\|endoftext\|>/g, '');
            }
            
            onChunk(chunk);
          } catch (parseError) {
            // Only log if it's not just an empty chunk - reduce noise
            if (trimmedLine !== 'data: [DONE]' && trimmedLine.trim() !== '') {
              console.warn('Failed to parse SSE chunk:', trimmedLine, 'Error:', parseError);
            }
          }
        }
      }
    } catch (error) {
      onError?.(error as Error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  // Convenience method to create a basic chat request
  createBasicRequest(
    model: string,
    messages: ChatCompletionMessage[],
    options: Partial<Omit<ChatCompletionRequest, 'model' | 'messages'>> = {}
  ): ChatCompletionRequest {
    return {
      model,
      messages,
      stream: false,
      temperature: 0.6,
      top_p: 0.9,
      ...options,
    };
  }

  // Ensure system message is present and add default if missing
  static ensureSystemMessage(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    const hasSystemMessage = messages.some(msg => msg.role === 'system');
    
    if (!hasSystemMessage) {
      const systemMessage: ChatCompletionMessage = {
        role: 'system',
        content: 'You are a helpful assistant. Be concise and clear in your responses.'
      };
      return [systemMessage, ...messages];
    }
    
    return messages;
  }

  // Add messages to existing conversation while maintaining system message
  static addMessagesToConversation(
    existingMessages: ChatCompletionMessage[],
    newMessages: ChatCompletionMessage[]
  ): ChatCompletionMessage[] {
    const systemMessage = existingMessages.find(msg => msg.role === 'system');
    const nonSystemMessages = existingMessages.filter(msg => msg.role !== 'system');
    
    const allMessages = [...nonSystemMessages, ...newMessages];
    
    if (systemMessage) {
      return [systemMessage, ...allMessages];
    }
    
    return ExternalChatAPI.ensureSystemMessage(allMessages);
  }
}

// Default instance - will be initialized with OpenRouter API key from environment
export const externalChatAPI = new ExternalChatAPI(
  OPENROUTER_API_BASE_URL, 
  process.env.OPENROUTER_API_KEY
);

// Tandem instance - uses the new Tandem API endpoint
export const tandemChatAPI = new ExternalChatAPI(
  TANDEM_API_BASE_URL
);

// Helper function to convert internal message format to external format
export function convertMessages(messages: Array<{ role: string; content: string }>): ChatCompletionMessage[] {
  return messages.map(msg => ({
    role: msg.role as 'system' | 'user' | 'assistant',
    content: msg.content,
  }));
}