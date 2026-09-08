import { test, expect } from './fixtures/api.fixture';

test.describe('TC-01 | Health check [P0]', () => {
  test('GET /api/health returns 200 with ok:true', async ({ noAuthApi }) => {
    const response = await noAuthApi.get('/api/health');

    // Distinguish nginx 503 (downscaler/pod killed) from app crash
    if (response.status() === 503) {
      const body = await response.text();
      const isDownscaler = body.includes('Service Temporarily Unavailable') && body.includes('nginx');
      throw new Error(
        isDownscaler
          ? 'PLATFORM DOWN: nginx 503 — kube-downscaler probably killed tandemn pods. Run: kubectl scale deployment tandemn -n tandemn --replicas=1 && kubectl annotate ns tandemn downscaler/exclude=true'
          : `PLATFORM DOWN: unexpected 503 — body: ${body.slice(0, 200)}`
      );
    }

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.time).toBe('string');
    expect(body.service).toBe('OpenRouter Clone API');
  });

  test('GET /api/health responds in under 3s', async ({ noAuthApi }) => {
    const start = Date.now();
    const response = await noAuthApi.get('/api/health');
    const elapsed = Date.now() - start;

    expect(response.status()).toBe(200);
    expect(elapsed).toBeLessThan(3000);
  });
});
