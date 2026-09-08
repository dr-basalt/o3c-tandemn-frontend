import { test, expect } from './fixtures/api.fixture';

test.describe('TC-09 | Credits balance via Clerk session [P1]', () => {
  test('GET /api/credits/balance with Clerk session cookie returns 200 + balance', async ({
    clerkApi,
  }) => {
    if (!process.env.E2E_CLERK_SESSION_COOKIE) {
      test.skip(true, 'E2E_CLERK_SESSION_COOKIE not set — skipping TC-09 (requires headful login)');
    }

    const response = await clerkApi.get('/api/credits/balance');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(typeof body.balance).toBe('number');
    expect(body.balance).toBeGreaterThanOrEqual(0);
    expect(typeof body.lastUpdated).toBe('string');
  });

  test('TC-09b: GET /api/credits/balance without session cookie returns 401', async ({
    noAuthApi,
  }) => {
    const response = await noAuthApi.get('/api/credits/balance');
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBeTruthy();
  });
});
