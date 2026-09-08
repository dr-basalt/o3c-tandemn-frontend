import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: 4,
  reporter: process.env.CI
    ? [['junit', { outputFile: 'e2e-results.xml' }], ['list']]
    : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://platform.ori3com.cloud',
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },
  projects: [{ name: 'api', use: {} }],
});
