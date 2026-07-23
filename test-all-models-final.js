#!/usr/bin/env node

// Comprehensive test of all 4 O3C models with correct endpoints
const models = [
  {
    name: "DeepSeek R1 Distilled Llama 70B",
    id: "casperhansen/deepseek-r1-distill-llama-70b-awq",
    endpoint: "http://34.207.103.140:8000/v1/chat/completions",
    params: {
      temperature: 0.6,
      top_p: 0.9,
      max_completion_tokens: 100
    },
    systemPrompt: "You are a helpful assistant"
  },
  {
    name: "Qwen3 32B",
    id: "Qwen/Qwen3-32B-AWQ",
    endpoint: "http://3.91.251.0:8000/v1/chat/completions",
    params: {
      temperature: 0.7,
      top_k: 20,
      top_p: 0.8,
      min_p: 0,
      max_completion_tokens: 100
    },
    systemPrompt: "You are a helpful assistant /no_think"
  },
  {
    name: "Devstral Small 2507",
    id: "btbtyler09/Devstral-Small-2507-AWQ",
    endpoint: "http://98.87.8.56:8000/v1/chat/completions",
    params: {
      temperature: 0.7,
      max_completion_tokens: 100
    },
    systemPrompt: `You are Devstral, a helpful agentic model trained by Mistral AI and using the OpenHands scaffold. You can interact with a computer to solve tasks.

<ROLE>
Your primary role is to assist users by executing commands, modifying code, and solving technical problems effectively. You should be thorough, methodical, and prioritize quality over speed.
* If the user asks a question, like "why is X happening", don't try to fix the problem. Just give an answer to the question.
</ROLE>`
  },
  {
    name: "Llama 3.3 70B Instruct",
    id: "casperhansen/llama-3.3-70b-instruct-awq",
    endpoint: "http://98.80.0.197:8001/v1/chat/completions",
    params: {
      temperature: 0.6,
      top_p: 0.9,
      max_completion_tokens: 100
    },
    systemPrompt: "You are a helpful assistant"
  }
];

async function testModel(model, testStreaming = false) {
  console.log(`\n🧪 Testing ${model.name}...`);
  console.log(`📍 Endpoint: ${model.endpoint}`);
  console.log(`🎯 Model ID: ${model.id}`);
  console.log(`🔄 Streaming: ${testStreaming ? 'YES' : 'NO'}`);

  try {
    const response = await fetch(model.endpoint, {
      method: 'POST',
      headers: {
        'Accept': testStreaming ? 'text/event-stream' : 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: "system", content: model.systemPrompt },
          { role: "user", content: "Hello! Can you tell me what model you are?" }
        ],
        stream: testStreaming,
        ...model.params
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ ${model.name}: ${response.status} - ${errorText.substring(0, 200)}`);
      return false;
    }

    if (testStreaming) {
      // Test streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let chunks = 0;
      let content = '';
      
      if (reader) {
        let buffer = '';
        const startTime = Date.now();
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            const lines = buffer.split('\\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              const trimmedLine = line.trim();
              
              if (trimmedLine === 'data: [DONE]') {
                console.log(`✅ ${model.name}: STREAMING OK (${chunks} chunks, ${Date.now() - startTime}ms)`);
                console.log(`📝 Sample: "${content.substring(0, 100)}..."`);
                return true;
              }
              
              if (trimmedLine.startsWith('data: ')) {
                try {
                  const jsonData = trimmedLine.slice(6);
                  const chunk = JSON.parse(jsonData);
                  const deltaContent = chunk.choices?.[0]?.delta?.content;
                  
                  if (deltaContent) {
                    chunks++;
                    content += deltaContent;
                    
                    // Stop after getting some content to avoid long responses
                    if (content.length > 100) {
                      reader.cancel();
                      console.log(`✅ ${model.name}: STREAMING OK (${chunks} chunks, partial)`);
                      console.log(`📝 Sample: "${content.substring(0, 100)}..."`);
                      return true;
                    }
                  }
                } catch (parseError) {
                  // Ignore parse errors
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
      
      return chunks > 0;
    } else {
      // Test non-streaming response
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content || '';
      
      if (content) {
        console.log(`✅ ${model.name}: NON-STREAMING OK`);
        console.log(`📝 Response: "${content.substring(0, 100)}..."`);
        return true;
      } else {
        console.log(`❌ ${model.name}: No content in response`);
        return false;
      }
    }
  } catch (error) {
    console.log(`❌ ${model.name}: ${error.message}`);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Testing All 4 O3C Models');
  console.log('=' .repeat(50));

  const results = {
    nonStreaming: {},
    streaming: {}
  };

  // Test non-streaming first
  console.log('\\n📄 Testing Non-Streaming Responses...');
  for (const model of models) {
    results.nonStreaming[model.name] = await testModel(model, false);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait between tests
  }

  // Test streaming
  console.log('\\n🌊 Testing Streaming Responses...');
  for (const model of models) {
    results.streaming[model.name] = await testModel(model, true);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait between tests
  }

  // Summary
  console.log('\\n📊 FINAL RESULTS');
  console.log('=' .repeat(50));
  
  let totalWorking = 0;
  const totalTests = models.length * 2; // non-streaming + streaming
  
  for (const model of models) {
    const nonStreamingStatus = results.nonStreaming[model.name] ? '✅' : '❌';
    const streamingStatus = results.streaming[model.name] ? '✅' : '❌';
    
    if (results.nonStreaming[model.name]) totalWorking++;
    if (results.streaming[model.name]) totalWorking++;
    
    console.log(`${nonStreamingStatus} ${streamingStatus} ${model.name}`);
  }
  
  console.log('\\n🎯 SUMMARY:');
  console.log(`Working: ${totalWorking}/${totalTests} tests`);
  console.log(`Models: ${models.length}/4 deployed`);
  
  if (totalWorking === totalTests) {
    console.log('🎉 ALL MODELS AND STREAMING WORKING PERFECTLY!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed - check deployment status');
    process.exit(1);
  }
}

// Run the tests
runAllTests().catch(console.error);