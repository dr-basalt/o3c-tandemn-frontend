import { test as base, APIRequestContext } from '@playwright/test';

type ApiFixtures = {
  authedApi: APIRequestContext;
  zeroCreditApi: APIRequestContext;
  noAuthApi: APIRequestContext;
  clerkApi: APIRequestContext;
};

const BASE_URL = process.env.E2E_BASE_URL ?? 'https://platform.ori3com.cloud';

export const test = base.extend<ApiFixtures>({
  authedApi: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${process.env.E2E_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
    });
    await use(ctx);
    await ctx.dispose();
  },

  zeroCreditApi: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${process.env.E2E_ZERO_BALANCE_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
    });
    await use(ctx);
    await ctx.dispose();
  },

  noAuthApi: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
      },
    });
    await use(ctx);
    await ctx.dispose();
  },

  clerkApi: async ({ playwright }, use) => {
    const sessionCookie = process.env.E2E_CLERK_SESSION_COOKIE ?? '';
    const ctx = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
    });
    await use(ctx);
    await ctx.dispose();
  },
});

export { expect } from '@playwright/test';
