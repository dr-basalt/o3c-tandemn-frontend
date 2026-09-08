import { test, expect } from './fixtures/api.fixture';

test.describe('TC-01 | Health check [P0]', () => {
  test('GET /api/health returns 200 with ok:true', async ({ noAuthApi }) => {
    const response = await noAuthApi.get('/api/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.time).toBe('string');
    expect(body.service).toBe('OpenRouter Clone API');
  });
});
