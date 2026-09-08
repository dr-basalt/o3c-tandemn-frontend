// LiteLLM admin API client — creates/manages per-user virtual keys.
// Requires LITELLM_MASTER_KEY env var. All functions degrade gracefully when it's absent.

function getLitellmBaseUrl(): string {
  return (process.env.OPENROUTER_API_BASE_URL || '').replace(/\/v1\/?$/, '');
}

export interface LitellmKeyInfo {
  key: string;
  spend: number;
  max_budget?: number | null;
  key_alias?: string;
  metadata?: Record<string, unknown>;
}

// Create a per-user virtual key in litellm-o3c.
// Returns the raw key value (sk-...) or null when LITELLM_MASTER_KEY is not set or the call fails.
export async function createLitellmVirtualKey(clerkUserId: string, initialBudget?: number): Promise<string | null> {
  const masterKey = process.env.LITELLM_MASTER_KEY;
  if (!masterKey) return null;

  try {
    const resp = await fetch(`${getLitellmBaseUrl()}/key/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${masterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key_alias: `o3c-${clerkUserId.slice(-12)}`,
        metadata: { clerk_user_id: clerkUserId, platform: 'o3c' },
        ...(initialBudget !== undefined ? { max_budget: initialBudget } : {}),
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data as { key?: string }).key ?? null;
  } catch {
    return null;
  }
}

// Update the max_budget of a virtual key. Fire-and-forget — never throws.
export async function updateLitellmKeyBudget(key: string, maxBudget: number): Promise<void> {
  const masterKey = process.env.LITELLM_MASTER_KEY;
  if (!masterKey) return;
  try {
    await fetch(`${getLitellmBaseUrl()}/key/update`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${masterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key, max_budget: maxBudget }),
    });
  } catch {
    // ignore
  }
}

// Delete a virtual key from litellm-o3c. Fire-and-forget — never throws.
export async function deleteLitellmVirtualKey(key: string): Promise<void> {
  const masterKey = process.env.LITELLM_MASTER_KEY;
  if (!masterKey) return;
  try {
    await fetch(`${getLitellmBaseUrl()}/key/delete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${masterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keys: [key] }),
    });
  } catch {
    // ignore
  }
}

// Return spend + budget info for a virtual key, or null on failure.
export async function getLitellmKeyInfo(key: string): Promise<LitellmKeyInfo | null> {
  const masterKey = process.env.LITELLM_MASTER_KEY;
  if (!masterKey) return null;
  try {
    const resp = await fetch(
      `${getLitellmBaseUrl()}/key/info?key=${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${masterKey}` } }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data as { info?: LitellmKeyInfo }).info ?? null;
  } catch {
    return null;
  }
}
