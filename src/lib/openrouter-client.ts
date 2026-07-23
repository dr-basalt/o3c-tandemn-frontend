export interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OpenRouterChatRequest {
  model: string;
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface OpenRouterChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string = process.env.OPENROUTER_API_BASE_URL || 'https://openrouter.ai/api/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
  }

  async chat(request: OpenRouterChatRequest): Promise<OpenRouterChatResponse> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is required');
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://o3c.ai', // Replace with your domain
        'X-Title': 'O3C Frontend',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  async chatWithTimeout(
    request: OpenRouterChatRequest, 
    timeoutMs: number = 30000
  ): Promise<OpenRouterChatResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://o3c.ai',
          'X-Title': 'O3C Frontend',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.statusText} - ${errorText}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('OpenRouter API request timed out');
      }
      throw error;
    }
  }

  async chatStreamWithTimeout(
    request: OpenRouterChatRequest,
    onChunk: (content: string) => void,
    timeoutMs: number = 30000
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const streamingRequest = { ...request, stream: true };
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://o3c.ai',
          'X-Title': 'O3C Frontend',
        },
        body: JSON.stringify(streamingRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.statusText} - ${errorText}`);
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
              const chunk = JSON.parse(jsonData);
              
              // Extract content from OpenRouter streaming format
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                onChunk(content);
              }
            } catch (parseError) {
              // Only log if it's not just an empty chunk
              if (trimmedLine !== 'data: [DONE]' && trimmedLine.trim() !== '') {
                console.warn('Failed to parse OpenRouter SSE chunk:', trimmedLine, 'Error:', parseError);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('OpenRouter API request timed out');
      }
      throw error;
    }
  }
}

// Create a singleton instance
export const openRouterClient = new OpenRouterClient();
