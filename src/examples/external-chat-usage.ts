import { externalChatAPI, o3cChatAPI, convertMessages, ExternalChatAPI } from '@/lib/external-chat-api';

// Example usage of the fallback chat API
// This will try O3C first, then fallback to OpenRouter if needed

export async function basicChatExample() {
  try {
    // Note: This uses OpenRouter directly - for the fallback pattern, use the internal API route instead
    const request = externalChatAPI.createBasicRequest(
      'meta-llama/llama-3.3-70b-instruct',
      [
        { role: 'system', content: 'You are Llama-70B' },
        { role: 'user', content: 'Give me the python code for solving an ML Equation' }
      ],
      {
        temperature: 0.6,
        top_p: 0.9
      }
    );

    const response = await externalChatAPI.createChatCompletion(request);
    console.log('Response:', response.choices[0].message.content);
    return response;
    
  } catch (error) {
    console.error('Chat completion failed:', error);
    throw error;
  }
}

export async function streamingChatExample() {
  try {
    // Note: This uses OpenRouter directly - for the fallback pattern, use the internal API route instead
    const request = externalChatAPI.createBasicRequest(
      'meta-llama/llama-3.3-70b-instruct',
      [
        { role: 'system', content: 'You are Llama-70B' },
        { role: 'user', content: 'Explain machine learning in simple terms' }
      ],
      {
        stream: true,
        temperature: 0.6,
        top_p: 0.9
      }
    );

    await externalChatAPI.createStreamingChatCompletion(
      request,
      (chunk) => {
        // Handle each streaming chunk
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          process.stdout.write(content); // Stream to console
        }
      },
      (error) => {
        console.error('Streaming error:', error);
      }
    );
    
  } catch (error) {
    console.error('Streaming chat failed:', error);
    throw error;
  }
}

// *** RECOMMENDED: Use the fallback API route (tries O3C first, then OpenRouter) ***

// Example usage with fallback API route - tries O3C first, then OpenRouter
export async function useFallbackAPIRoute(apiKey: string) {
  try {
    const response = await fetch('/api/v1/external-chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'casperhansen/llama-3.3-70b-instruct-awq', // This will be used for O3C (OpenRouter uses different model)
        stream: false,
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Be concise and clear in your responses.' },
          { role: 'user', content: 'Give me the python code for solving an ML Equation' }
        ],
        max_completion_tokens: 2000,
        temperature: 0.6,
        top_p: 0.9
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const result = await response.json();
    
    // Check which service was used
    console.log(`Response from: ${result.processing_source || 'unknown'}`);
    console.log(`Fallback used: ${result.fallback_used ? 'Yes' : 'No'}`);
    console.log('Response:', result.choices[0].message.content);
    
    return result;
    
  } catch (error) {
    console.error('Fallback API request failed:', error);
    throw error;
  }
}

// Example usage with streaming via fallback API route
export async function useFallbackStreamingRoute(apiKey: string) {
  try {
    const response = await fetch('/api/v1/external-chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model: 'casperhansen/llama-3.3-70b-instruct-awq',
        stream: true,
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Be concise and clear in your responses.' },
          { role: 'user', content: 'Explain machine learning concepts' }
        ],
        max_completion_tokens: 2000,
        temperature: 0.6,
        top_p: 0.9
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('Response body is not readable');
    }

    let buffer = '';
    let processingSource = 'unknown';
    let fallbackUsed = false;
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (trimmedLine === '' || !trimmedLine.startsWith('data: ')) continue;
        if (trimmedLine === 'data: [DONE]') {
          console.log(`\n\nStream completed. Source: ${processingSource}, Fallback used: ${fallbackUsed}`);
          return;
        }
        
        try {
          const jsonData = trimmedLine.slice(6);
          const chunk = JSON.parse(jsonData);
          
          if (chunk.error) {
            console.error('Stream error:', chunk.error);
            break;
          }
          
          // Track which service is being used
          if (chunk.processing_source) {
            processingSource = chunk.processing_source;
            fallbackUsed = chunk.fallback_used || false;
          }
          
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            process.stdout.write(content);
          }
        } catch (parseError) {
          console.warn('Failed to parse chunk:', trimmedLine);
        }
      }
    }
    
  } catch (error) {
    console.error('Fallback streaming API request failed:', error);
    throw error;
  }
}

// Example showing how to handle different response types
export async function demonstrateFallbackBehavior(apiKey: string) {
  console.log('=== Testing Fallback Behavior ===');
  
  try {
    const result = await useFallbackAPIRoute(apiKey);
    
    if (result.processing_source === 'o3c') {
      console.log('✅ Success: O3C internal system handled the request');
    } else if (result.processing_source === 'openrouter') {
      console.log('🔄 Fallback: OpenRouter handled the request after O3C failed');
    }
    
    console.log(`Credits charged: $${result.pricing?.credits_charged || 'unknown'}`);
    console.log(`Credits remaining: $${result.pricing?.credits_remaining || 'unknown'}`);
    
  } catch (error) {
    console.error('Both services failed:', error);
  }
}

// Example showing message accumulation in a conversation
export async function demonstrateMessageAccumulation(apiKey: string) {
  console.log('=== Demonstrating Message Accumulation ===');
  
  // Start with initial messages
  let conversationMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'user' as const, content: 'Hello! What is machine learning?' }
  ];
  
  console.log('Initial messages:', conversationMessages.length);
  
  try {
    // First API call - system message will be automatically added
    const firstResponse = await fetch('/api/v1/external-chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'casperhansen/llama-3.3-70b-instruct-awq',
        stream: false,
        messages: conversationMessages,
        max_completion_tokens: 2000,
        temperature: 0.6,
        top_p: 0.9
      })
    });

    const firstResult = await firstResponse.json();
    console.log('First response from:', firstResult.processing_source);
    
    // Add assistant response to conversation
    conversationMessages.push({
      role: 'assistant' as const,
      content: firstResult.choices[0].message.content
    });
    
    console.log('Messages after first response:', conversationMessages.length);
    
    // Add follow-up user message
    conversationMessages.push({
      role: 'user' as const,
      content: 'Please continue ahead and tell me about neural networks'
    });
    
    console.log('Messages after user follow-up:', conversationMessages.length);
    
    // Second API call - the conversation continues with accumulated messages
    const secondResponse = await fetch('/api/v1/external-chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'casperhansen/llama-3.3-70b-instruct-awq',
        stream: false,
        messages: conversationMessages,
        max_completion_tokens: 2000,
        temperature: 0.6,
        top_p: 0.9
      })
    });

    const secondResult = await secondResponse.json();
    console.log('Second response from:', secondResult.processing_source);
    
    // Add second assistant response
    conversationMessages.push({
      role: 'assistant' as const,
      content: secondResult.choices[0].message.content
    });
    
    console.log('Final messages count:', conversationMessages.length);
    console.log('System message automatically added:', conversationMessages.some(msg => msg.role === 'system'));
    
    return conversationMessages;
    
  } catch (error) {
    console.error('Message accumulation demo failed:', error);
    throw error;
  }
}

// Example demonstrating static helper methods for message management
export function demonstrateMessageHelpers() {
  console.log('=== Message Helper Functions ===');
  
  // Example messages without system message
  const messagesWithoutSystem = [
    { role: 'user' as const, content: 'Hello!' },
    { role: 'assistant' as const, content: 'Hi there!' },
    { role: 'user' as const, content: 'How are you?' }
  ];
  
  console.log('Original messages:', messagesWithoutSystem.length);
  
  // Add system message automatically
  const withSystemMessage = ExternalChatAPI.ensureSystemMessage(messagesWithoutSystem);
  console.log('After ensuring system message:', withSystemMessage.length);
  console.log('Now has system message:', withSystemMessage.some(msg => msg.role === 'system'));
  
  // Demonstrate conversation continuation
  const existingConversation = [
    { role: 'system' as const, content: 'You are a helpful assistant.' },
    { role: 'user' as const, content: 'Tell me about AI' },
    { role: 'assistant' as const, content: 'AI is...' }
  ];
  
  const newMessages = [
    { role: 'user' as const, content: 'What about machine learning?' },
    { role: 'assistant' as const, content: 'Machine learning is...' }
  ];
  
  const combinedConversation = ExternalChatAPI.addMessagesToConversation(existingConversation, newMessages);
  
  console.log('Existing conversation length:', existingConversation.length);
  console.log('New messages length:', newMessages.length);
  console.log('Combined conversation length:', combinedConversation.length);
  console.log('System message preserved:', combinedConversation[0].role === 'system');
  
  return {
    withSystemMessage,
    combinedConversation
  };
}