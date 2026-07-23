#!/usr/bin/env node

/**
 * Comprehensive test script for all O3C models through the API gateway
 * Tests each model with different types of requests to ensure functionality
 */

const fs = require('fs');

// Configuration
const BASE_URL = 'http://localhost:3000';
const API_ENDPOINT = `${BASE_URL}/api/v1/chat/completions`;

// Test scenarios for different model capabilities
const TEST_SCENARIOS = {
  'basic': {
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello! Please respond with just "Test successful" if you can understand this message.' }
    ],
    max_completion_tokens: 50
  },
  'reasoning': {
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is 15 + 27? Please show your work briefly.' }
    ],
    max_completion_tokens: 100
  },
  'coding': {
    messages: [
      { role: 'system', content: 'You are a helpful coding assistant.' },
      { role: 'user', content: 'Write a simple Python function to add two numbers. Just the function, no explanation needed.' }
    ],
    max_completion_tokens: 150
  }
};

// Models to test (from your configuration)
const MODELS = [
  {
    id: 'casperhansen/deepseek-r1-distill-llama-70b-awq',
    name: 'DeepSeek R1 Distilled Llama 70B',
    scenarios: ['basic', 'reasoning', 'coding']
  },
  {
    id: 'Qwen/Qwen3-32B-AWQ', 
    name: 'Qwen3 32B',
    scenarios: ['basic', 'reasoning', 'coding']
  },
  {
    id: 'btbtyler09/Devstral-Small-2507-AWQ',
    name: 'Devstral Small 2507',
    scenarios: ['basic', 'coding'] // This model has max_tokens: 100, so shorter tests
  },
  {
    id: 'casperhansen/llama-3.3-70b-instruct-awq',
    name: 'Llama 3.3 70B Instruct', 
    scenarios: ['basic', 'reasoning', 'coding']
  }
];

// Utility functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const makeRequest = async (model, scenario, streamMode = false) => {
  const testData = TEST_SCENARIOS[scenario];
  const payload = {
    model: model.id,
    messages: testData.messages,
    max_completion_tokens: testData.max_completion_tokens,
    temperature: 0.3,
    stream: streamMode
  };

  const startTime = Date.now();
  
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': streamMode ? 'text/event-stream' : 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify(payload)
    });

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
        responseTime,
        streamMode
      };
    }

    if (streamMode) {
      // Handle streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let chunks = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              
              try {
                const parsed = JSON.parse(data);
                if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                  fullResponse += parsed.choices[0].delta.content;
                  chunks++;
                }
              } catch (e) {
                // Skip malformed JSON chunks
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return {
        success: true,
        response: fullResponse.trim(),
        responseTime,
        streamMode: true,
        chunks
      };
    } else {
      // Handle non-streaming response
      const data = await response.json();
      
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return {
          success: true,
          response: data.choices[0].message.content,
          responseTime,
          streamMode: false,
          usage: data.usage
        };
      } else {
        return {
          success: false,
          error: 'Invalid response format',
          responseTime,
          streamMode: false,
          rawResponse: data
        };
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      responseTime: Date.now() - startTime,
      streamMode
    };
  }
};

const testModel = async (model) => {
  console.log(`\\n🧪 Testing ${model.name} (${model.id})`);
  console.log('=' .repeat(80));
  
  const results = {
    model: model.name,
    modelId: model.id,
    scenarios: {},
    summary: {
      total: 0,
      passed: 0,
      failed: 0
    }
  };

  for (const scenario of model.scenarios) {
    console.log(`\\n📋 Testing scenario: ${scenario}`);
    
    // Test both streaming and non-streaming modes
    for (const streamMode of [false, true]) {
      const mode = streamMode ? 'streaming' : 'non-streaming';
      console.log(`  ${mode}...`);
      
      const result = await makeRequest(model, scenario, streamMode);
      
      const testKey = `${scenario}_${mode}`;
      results.scenarios[testKey] = result;
      results.summary.total++;
      
      if (result.success) {
        results.summary.passed++;
        console.log(`  ✅ ${mode}: SUCCESS (${result.responseTime}ms)`);
        
        if (result.response) {
          const preview = result.response.substring(0, 100);
          console.log(`     Response preview: "${preview}${result.response.length > 100 ? '...' : ''}"`);
        }
        
        if (result.chunks) {
          console.log(`     Received ${result.chunks} chunks`);
        }
        
        if (result.usage) {
          console.log(`     Tokens used: ${result.usage.prompt_tokens} prompt, ${result.usage.completion_tokens} completion`);
        }
      } else {
        results.summary.failed++;
        console.log(`  ❌ ${mode}: FAILED (${result.responseTime}ms)`);
        console.log(`     Error: ${result.error}`);
      }
      
      // Small delay between requests to avoid overwhelming the server
      await sleep(1000);
    }
  }
  
  return results;
};

const main = async () => {
  console.log('🚀 Starting comprehensive test of all O3C models through API gateway');
  console.log(`📡 Testing endpoint: ${API_ENDPOINT}`);
  console.log(`📅 Test started at: ${new Date().toISOString()}`);
  
  const allResults = [];
  const overallSummary = {
    totalTests: 0,
    totalPassed: 0,
    totalFailed: 0,
    modelResults: {}
  };

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    
    try {
      const results = await testModel(model);
      allResults.push(results);
      
      // Update overall summary
      overallSummary.totalTests += results.summary.total;
      overallSummary.totalPassed += results.summary.passed;
      overallSummary.totalFailed += results.summary.failed;
      overallSummary.modelResults[model.id] = {
        name: model.name,
        passed: results.summary.passed,
        failed: results.summary.failed,
        success_rate: ((results.summary.passed / results.summary.total) * 100).toFixed(1)
      };
      
      // Pause between models to avoid overwhelming the gateway
      if (i < MODELS.length - 1) {
        console.log('\\n⏳ Pausing 3 seconds before next model...');
        await sleep(3000);
      }
      
    } catch (error) {
      console.log(`\\n❌ Failed to test ${model.name}: ${error.message}`);
      overallSummary.modelResults[model.id] = {
        name: model.name,
        passed: 0,
        failed: 1,
        success_rate: '0.0',
        error: error.message
      };
    }
  }

  // Print final summary
  console.log('\\n\\n📊 FINAL TEST SUMMARY');
  console.log('=' .repeat(80));
  console.log(`📅 Test completed at: ${new Date().toISOString()}`);
  console.log(`🎯 Overall Results: ${overallSummary.totalPassed}/${overallSummary.totalTests} tests passed (${((overallSummary.totalPassed / overallSummary.totalTests) * 100).toFixed(1)}%)`);
  
  console.log('\\n📈 Per-model results:');
  for (const [modelId, result] of Object.entries(overallSummary.modelResults)) {
    const status = result.success_rate === '100.0' ? '✅' : result.success_rate === '0.0' ? '❌' : '⚠️';
    console.log(`  ${status} ${result.name}: ${result.passed}/${result.passed + result.failed} (${result.success_rate}%)`);
    if (result.error) {
      console.log(`      Error: ${result.error}`);
    }
  }

  // Save detailed results to file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `test-results-${timestamp}.json`;
  
  const detailedResults = {
    timestamp: new Date().toISOString(),
    endpoint: API_ENDPOINT,
    summary: overallSummary,
    detailed_results: allResults
  };
  
  fs.writeFileSync(filename, JSON.stringify(detailedResults, null, 2));
  console.log(`\\n💾 Detailed results saved to: ${filename}`);
  
  // Exit with appropriate code
  process.exit(overallSummary.totalFailed > 0 ? 1 : 0);
};

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('\\n❌ Unhandled error:', error);
  process.exit(1);
});

// Start the tests
main().catch(console.error);