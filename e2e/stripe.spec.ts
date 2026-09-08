import { test, expect } from './fixtures/api.fixture';

test.describe('TC-10 | Stripe checkout session initiation [P1]', () => {
  test('POST /api/stripe/checkout with Clerk session returns checkout URL + sessionId', async ({
    clerkApi,
  }) => {
    if (!process.env.E2E_CLERK_SESSION_COOKIE) {
      test.skip(true, 'E2E_CLERK_SESSION_COOKIE not set — skipping TC-10 (requires headful login)');
    }

    const response = await clerkApi.post('/api/stripe/checkout', {
      data: { packageId: 'starter' },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(typeof body.url).toBe('string');
    expect(body.url.startsWith('https://checkout.stripe.com/')).toBe(true);
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.startsWith('cs_')).toBe(true);
  });

  test('TC-10b: POST /api/stripe/checkout without session cookie returns 401', async ({
    noAuthApi,
  }) => {
    const response = await noAuthApi.post('/api/stripe/checkout', {
      data: { packageId: 'starter' },
    });
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBeTruthy();
  });
});
