#!/usr/bin/env node

// Test the Llama model using the production API that you showed works
const API_BASE = 'https://o3c-frontend-psi.vercel.app';
const API_KEY = 'gk-mLMITDrP_3ewsnz1nmzz';

async function testProductionLlama() {
  console.log('🧪 Testing Llama via production API...');
  console.log('🔗 Using your working curl command format');
  
  try {
    const response = await fetch(`${API_BASE}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "casperhansen/llama-3.3-70b-instruct-awq",
        messages: [
          {role: "user", content: "Hello! Can you explain quantum computing?"}
        ]
      })
    });

    console.log(`📊 Response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Error: ${errorText}`);
      return false;
    }

    const data = await response.json();
    console.log('✅ Llama working via production API!');
    console.log('📝 Response:', data.choices?.[0]?.message?.content?.substring(0, 100) + '...');
    
    return true;
    
  } catch (error) {
    console.error(`❌ Request failed: ${error.message}`);
    return false;
  }
}

async function testStreamingLlama() {
  console.log('\n🧪 Testing Llama streaming via production API...');
  
  try {
    const response = await fetch(`${API_BASE}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        model: "casperhansen/llama-3.3-70b-instruct-awq",
        messages: [
          {role: "user", content: "Write a short poem about AI"}
        ],
        stream: true
      })
    });

    if (!response.ok) {
      console.log('❌ Streaming not supported or different endpoint');
      return false;
    }

    console.log('✅ Llama streaming works via production API!');
    
    // Read a few chunks
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let chunks = 0;
    
    if (reader) {
      try {
        for (let i = 0; i < 10; i++) { // Read first 10 chunks
          const { done, value } = await reader.read();
          if (done) break;
          
          const text = decoder.decode(value);
          if (text.includes('data:')) {
            chunks++;
          }
        }
        
        reader.cancel();
        console.log(`📊 Received ${chunks} streaming chunks`);
      } finally {
        reader.releaseLock();
      }
    }
    
    return true;
    
  } catch (error) {
    console.error(`❌ Streaming test failed: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Testing Llama model via production API...\n');
  
  const regularTest = await testProductionLlama();
  const streamingTest = await testStreamingLlama();
  
  console.log('\n📋 Results:');
  console.log('===========');
  console.log(`${regularTest ? '✅' : '❌'} Regular API call`);
  console.log(`${streamingTest ? '✅' : '❌'} Streaming API call`);
  
  if (regularTest) {
    console.log('\n🎉 Llama model is working via production API!');
    console.log('💡 The model is available through the v1/chat API routing');
    console.log('🔧 No direct endpoint needed - it routes through the gateway');
  }
}

runTests().catch(console.error);