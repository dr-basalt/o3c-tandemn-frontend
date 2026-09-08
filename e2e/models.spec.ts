import { test, expect } from './fixtures/api.fixture';

const BRANDED_IDS = ['o3c-expert', 'o3c-auto', 'o3c-mini', 'o3c-code', 'o3c-reason'];

test.describe('TC-02 | Models list — structure and cardinality [P0]', () => {
  test('GET /api/v1/models returns ≥13 models with expected branded IDs', async ({
    authedApi,
    playwright,
  }) => {
    if (!process.env.E2E_API_KEY) {
      test.skip(!process.env.CI, 'E2E_API_KEY not set — skipping outside CI');
    }

    const response = await authedApi.get('/api/v1/models');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(13);

    for (const model of body.data) {
      expect(typeof model.id).toBe('string');
      expect(model.object).toBe('model');
      expect(typeof model.owned_by).toBe('string');
    }

    const ids = body.data.map((m: { id: string }) => m.id);
    for (const brandedId of BRANDED_IDS) {
      expect(ids).toContain(brandedId);
    }
  });
});

test.describe('TC-03 | Unknown model → 404 [P2]', () => {
  test('POST /api/v1/chat/completions with unknown model returns 404', async ({ authedApi }) => {
    if (!process.env.E2E_API_KEY) {
      test.skip(!process.env.CI, 'E2E_API_KEY not set — skipping outside CI');
    }

    const response = await authedApi.post('/api/v1/chat/completions', {
      data: {
        model: 'o3c-does-not-exist',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body.error).toBeTruthy();
    const errorStr = JSON.stringify(body.error).toLowerCase();
    expect(errorStr.includes('not found') || errorStr.includes('model')).toBe(true);
  });
});
