# E2E Test Accounts

**Last updated:** 2026-09-08

---

## Account Registry

### 1. Account with positive balance — TC-07, TC-08

| Field | Value |
|-------|-------|
| Email | e2e-funded@ori3com.cloud (or any account with credit) |
| Purpose | Happy path chat completions (TC-07 vLLM direct, TC-08 o3c-auto) |
| API Key | Stored in CI secret `E2E_API_KEY` |
| Balance | Must remain > $0 — top up periodically |
| Rule | Check balance before running TC-07/TC-08 in CI; if 0, top up or disable these tests |

### 2. Zero-balance account — TC-06

| Field | Value |
|-------|-------|
| Email | e2e-penniless@ori3com.cloud |
| Purpose | Verify 402 credit gate (TC-06) |
| API Key | Stored in CI secret `E2E_ZERO_BALANCE_API_KEY` |
| Balance | **Always $0 — NEVER recharge this account** |
| Rule | If this account ever gets a credit (e.g. promo), TC-06 will fail — investigate |

### 3. Clerk session account — TC-09, TC-10

| Field | Value |
|-------|-------|
| Email | e2e-session@ori3com.cloud (or any valid Clerk account) |
| Purpose | `/api/credits/balance` and `/api/stripe/checkout` require a Clerk `__session` cookie |
| Cookie | Stored in CI secret `E2E_CLERK_SESSION_COOKIE` (format: `__session=eyJ...`) |
| Expiry | Clerk JWTs expire — refresh the `E2E_CLERK_SESSION_COOKIE` secret periodically |
| How to obtain | `npx playwright codegen https://platform.ori3com.cloud` — log in, copy the `__session` cookie from browser devtools |

---

## How to Refresh the Clerk Session Cookie

1. Install Playwright browsers locally: `npx playwright install chromium`
2. Run codegen: `npx playwright codegen https://platform.ori3com.cloud`
3. Log in with the e2e-session account in the opened browser
4. Open DevTools → Application → Cookies → copy `__session` value
5. Update the GitHub Actions secret `E2E_CLERK_SESSION_COOKIE` with `__session=<value>`

---

## Security Rules

- Never commit real API keys or session cookies to the repo
- All secrets live exclusively in GitHub Actions secrets and local `.env.test` (gitignored)
- The zero-balance account must never be recharged — it is the 402 gate sentinel
- Rotate `E2E_API_KEY` if it is ever leaked or exposed in logs
