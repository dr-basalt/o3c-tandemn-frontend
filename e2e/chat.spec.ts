import { test, expect } from './fixtures/api.fixture';

const DIRECT_VLLLM_MODELS = [
  'casperhansen/deepseek-r1-distill-llama-70b-awq',
  'Qwen/Qwen3-32B-AWQ',
  'btbtyler09/Devstral-Small-2507-AWQ',
  'casperhansen/llama-3.3-70b-instruct-awq',
];

test.describe('TC-04 | Chat without auth → 401 [P2]', () => {
  test('POST /api/v1/chat/completions without Authorization returns 401', async ({ noAuthApi }) => {
    const response = await noAuthApi.post('/api/v1/chat/completions', {
      data: {
        model: DIRECT_VLLLM_MODELS[0],
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBeTruthy();
    const errorStr = JSON.stringify(body.error).toLowerCase();
    expect(errorStr.includes('authorization') || errorStr.includes('auth') || errorStr.includes('unauthorized')).toBe(true);
  });
});

test.describe('TC-05 | Chat with invalid API key → 401 [P2]', () => {
  test('POST /api/v1/chat/completions with bad key returns 401', async ({ playwright }) => {
    const badKeyApi = await playwright.request.newContext({
      baseURL: process.env.E2E_BASE_URL ?? 'https://platform.ori3com.cloud',
      extraHTTPHeaders: {
        Authorization: 'Bearer gk-AAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'Content-Type': 'application/json',
      },
    });

    const response = await badKeyApi.post('/api/v1/chat/completions', {
      data: {
        model: DIRECT_VLLLM_MODELS[0],
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    await badKeyApi.dispose();

    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBeTruthy();
  });
});

test.describe('TC-06 | Zero balance → 402 [P1]', () => {
  test('POST /api/v1/chat/completions with $0 balance account returns 402', async ({
    zeroCreditApi,
  }) => {
    if (!process.env.E2E_ZERO_BALANCE_API_KEY) {
      test.skip(true, 'E2E_ZERO_BALANCE_API_KEY not set — skipping TC-06');
    }

    const response = await zeroCreditApi.post('/api/v1/chat/completions', {
      data: {
        model: DIRECT_VLLLM_MODELS[0],
        messages: [{ role: 'user', content: 'Write me a long essay' }],
        max_tokens: 500,
      },
    });
    expect(response.status()).toBe(402);

    const body = await response.json();
    expect(body.error).toBeTruthy();
    const errorStr = JSON.stringify(body).toLowerCase();
    expect(
      errorStr.includes('insufficient credits') ||
      errorStr.includes('credits_required') ||
      errorStr.includes('credits')
    ).toBe(true);
  });
});

test.describe('TC-07 | Direct vLLM chat — non-stream [P1]', () => {
  for (const model of DIRECT_VLLLM_MODELS) {
    test(`POST /api/v1/chat/completions non-stream succeeds for model: ${model}`, async ({
      authedApi,
    }) => {
      if (!process.env.E2E_API_KEY) {
        test.skip(true, 'E2E_API_KEY not set — skipping TC-07');
      }

      const response = await authedApi.post('/api/v1/chat/completions', {
        data: {
          model,
          messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
          max_tokens: 20,
          stream: false,
        },
      });
      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(Array.isArray(body.choices)).toBe(true);
      expect(body.choices.length).toBeGreaterThan(0);

      const content = body.choices[0]?.message?.content;
      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);

      expect(body.usage).toBeTruthy();
      expect(body.usage.prompt_tokens).toBeGreaterThan(0);

      if (body.credits_charged !== undefined) {
        expect(body.credits_charged).toBeGreaterThan(0);
      }
    });
  }
});

test.describe('TC-08 | Branded o3c-auto → litellm proxy [P1]', () => {
  test('POST /api/v1/chat/completions with o3c-auto returns 200 or 503', async ({ authedApi }) => {
    if (!process.env.E2E_API_KEY) {
      test.skip(true, 'E2E_API_KEY not set — skipping TC-08');
    }

    const response = await authedApi.post('/api/v1/chat/completions', {
      data: {
        model: 'o3c-auto',
        messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
        max_tokens: 20,
        stream: false,
      },
    });

    const status = response.status();

    if (status === 503) {
      console.log('TC-08: litellm-o3c returned 503 — upstream may be down, skipping assertion');
      test.skip(true, 'litellm-o3c returned 503 — upstream unavailable');
    }

    expect(status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.choices)).toBe(true);
    expect(body.choices.length).toBeGreaterThan(0);

    const content = body.choices[0]?.message?.content;
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
  });
});
