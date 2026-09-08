# E2E Testing Research — platform.ori3com.cloud

**Researched:** 2026-09-08
**Domain:** API end-to-end testing, Next.js production deployment
**Confidence:** HIGH

---

## Summary

`platform.ori3com.cloud` is a Next.js 15 / React 19 app acting as a sovereign OpenRouter clone.
It has **zero existing test infrastructure** — no jest, vitest, playwright config, or test
files in the repo. The only prior art is a handful of ad-hoc Node.js scripts (`test-models.js`,
`test-api-streaming.js`, etc.) that hit localhost or raw vLLM endpoints directly. These scripts
are not runnable in CI and have no assertions.

The surface to test breaks into two clear layers:
- **Auth-free endpoints** — `/api/health`, `/api/v1/models` (API-key only)
- **Auth-bound endpoints** — `/api/credits/balance`, `/api/stripe/checkout` (Clerk session cookie,
  not API-key), `/api/v1/chat/completions` (API-key + credit balance gate)

The chat proxy has a feature-flag split: when `GATEWAY_ENABLED=true` it routes through an internal
mock gateway (the `db` mock + `simple-gateway`); otherwise it forwards to real LiteLLM-o3c or
per-model vLLM endpoints. In production the gateway is the active path.

**Primary recommendation:** Use `@playwright/test` in pure API mode (no browser) for all 10 test
cases. It ships a built-in `APIRequestContext`, supports SSE streams, runs in GitHub Actions with
zero extra infrastructure, and produces JUnit XML for CI reporting.

---

## Audit de l'existant

| Item | Présent | Notes |
|------|---------|-------|
| Test framework config (jest/vitest/playwright) | Non | Aucun fichier de config trouvé |
| Test directory (`test/`, `__tests__/`, `e2e/`) | Non | |
| Test scripts dans `package.json` | Non | Uniquement `dev`, `build`, `start`, `lint`, migrations |
| Scripts ad-hoc | Oui (`test-*.js`, `load-test.js`) | Non CI-friendly, pas d'assertions formelles |
| Couverture CI (GitHub Actions) | Non | `.github/` absent du repo |
| Endpoint `/api/health` | Oui — répond `{"ok":true}` | [VERIFIED: curl prod] |
| Endpoint `GET /api/v1/models` | Oui — renvoie 18 modèles | [VERIFIED: curl prod] |
| Endpoint `POST /api/v1/chat/completions` | Oui — 401 sans auth, 404 modèle inconnu | [VERIFIED: curl prod] |
| Endpoint `GET /api/credits/balance` | Oui — 401 sans session Clerk | [VERIFIED: curl prod] |
| Endpoint `POST /api/stripe/checkout` | Oui — 401 sans session Clerk | [VERIFIED: curl prod] |

---

## Comparatif des outils

### @playwright/test v1.63.0 [VERIFIED: npm registry]

**Points forts :**
- `APIRequestContext` — HTTP natif (GET/POST/SSE) sans navigateur
- Fixtures et parallelisme built-in
- Reporter JUnit XML pour GitHub Actions
- Même outil si on veut ajouter des tests UI plus tard
- Stable depuis 2020, 50M+ dl/semaine, Microsoft-maintained [ASSUMED: weekly download count from training data]

**Points faibles :**
- Binaire Chromium/Firefox téléchargé même si on n'utilise que l'API mode (contournable avec `--browser=none` ou `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`)

### Hurl v0.2.7 (npm wrapper) / CLI native [VERIFIED: npm registry — wrapper only]

**Points forts :**
- Format `.hurl` très lisible (markdown-like), idéal pour documenter les contrats d'API
- Assertions JSON intégrées, support SSE en preview

**Points faibles :**
- Le package npm `hurl` v0.2.7 est un wrapper non-officiel, potentiellement SUS — la vraie CLI est `hurl.dev` (Rust, install via `brew install hurl` ou script)
- Pas de fixtures TypeScript, pas de setup/teardown programmatique
- Support SSE encore limité (streaming fragmenté)
- Moins adapté pour orchestrer des scénarios multi-step avec état partagé (ex: créer une clé, l'utiliser, vérifier le débit)

### Newman v6.2.2 [VERIFIED: npm registry]

**Points forts :**
- Exécute des collections Postman exportées
- Reporter HTML + JUnit

**Points faibles :**
- Requiert de maintenir une collection Postman JSON (friction)
- Pas de support natif SSE streaming
- Pas de TypeScript natif

### Verdict

**Utiliser `@playwright/test` en mode API uniquement.**

Raisons : (1) zéro infra supplémentaire, (2) TypeScript natif et refactorable, (3) SSE streaming
testable via `response.body()` reader, (4) facilement extensible vers des tests UI si besoin,
(5) GitHub Actions support officiel avec cache `playwright` action.

---

## Package Legitimacy Audit

| Package | Registry | Age | Verdict | Disposition |
|---------|----------|-----|---------|-------------|
| `@playwright/test` | npm | ~6 ans (2020) | OK | Approuvé |
| `newman` | npm | ~12 ans (2014) | OK | Non retenu (outil alternatif) |
| `hurl` (npm wrapper) | npm | wrapper non-officiel | SUS | Non retenu — utiliser binary natif si besoin |

**Packages removed due to SLOP verdict:** none
**Packages flagged SUS:** `hurl` (npm) — wrapper non-officiel. La CLI officielle s'installe via `hurl.dev`, pas npm. Non utilisée dans ce plan.

---

## Plan de tests — 10 cas de test

### Structure de priorité

```
P0 — Infrastructure de base (toujours doit passer)
P1 — Happy paths métier (chemin nominal)
P2 — Edge cases et sécurité (régression critique)
```

---

### TC-01 | Health check [P0]

**Endpoint :** `GET /api/health`
**Auth :** aucune
**Assertion :**
- Status 200
- Body `{ ok: true }` (champ `time` présent, `service` === `"OpenRouter Clone API"`)
**Objectif :** confirme que le déploiement répond avant de lancer les autres tests.

---

### TC-02 | Liste des modèles — structure et cardinalité [P0]

**Endpoint :** `GET /api/v1/models`
**Auth :** `Authorization: Bearer gk-oA7c6EE9_zm69hma9mdf`
**Assertions :**
- Status 200
- Body `{ object: "list", data: [...] }`
- `data.length >= 13` (au moins les 13 branded o3c-*)
- Chaque item a : `id` (string), `object === "model"`, `owned_by` (string)
- Présence des IDs branded attendus : `o3c-expert`, `o3c-auto`, `o3c-mini`, `o3c-code`, `o3c-reason`
**Objectif :** détecte toute régression sur la liste de modèles exposée à l'UI `/models`.

---

### TC-03 | Modèle inconnu → 404 [P2]

**Endpoint :** `POST /api/v1/chat/completions`
**Auth :** `Authorization: Bearer gk-oA7c6EE9_zm69hma9mdf`
**Body :** `{ "model": "o3c-does-not-exist", "messages": [{"role":"user","content":"hi"}] }`
**Assertions :**
- Status 404
- Body contient `error` avec mention `"not found"` ou `"Model"`
**Objectif :** vérifie que le backend retourne 404 (pas 500) pour un modèle invalide.

---

### TC-04 | Chat sans auth → 401 [P2]

**Endpoint :** `POST /api/v1/chat/completions`
**Auth :** aucune
**Body :** `{ "model": "casperhansen/deepseek-r1-distill-llama-70b-awq", "messages": [{"role":"user","content":"hi"}] }`
**Assertions :**
- Status 401
- Body contient `error` mentionnant `Authorization`
**Objectif :** vérifie que l'endpoint n'est pas ouvert sans authentification.

---

### TC-05 | Chat avec API key invalide → 401 [P2]

**Endpoint :** `POST /api/v1/chat/completions`
**Auth :** `Authorization: Bearer gk-AAAAAAAAAAAAAAAAAAAAAAAAAAAA`
**Body :** `{ "model": "casperhansen/deepseek-r1-distill-llama-70b-awq", "messages": [{"role":"user","content":"hi"}] }`
**Assertions :**
- Status 401
- Body `{ error: "Invalid API key" }`
**Objectif :** distingue "pas d'auth" (TC-04) de "mauvaise auth" (TC-05).

---

### TC-06 | Blocage 402 — solde insuffisant [P1]

**Setup :** utiliser un compte test dont le solde est connu à $0.
**Endpoint :** `POST /api/v1/chat/completions`
**Auth :** API key du compte à $0
**Body :** `{ "model": "casperhansen/deepseek-r1-distill-llama-70b-awq", "messages": [{"role":"user","content":"Write me a long essay"}], "max_tokens": 500 }`
**Assertions :**
- Status 402
- Body contient `credits_required`, `credits_available`, et `error` avec `"Insufficient credits"`
**Objectif :** vérifie que la garde monétaire fonctionne — le service ne répond pas gratuitement.

**Note d'implémentation :** créer un compte dédié `e2e-penniless@ori3com.cloud` avec solde $0 et
générer une API key fixe pour les tests CI. Ne jamais recharger ce compte.

---

### TC-07 | Chat direct — modèle vLLM, réponse non-stream [P1]

**Endpoint :** `POST /api/v1/chat/completions`
**Auth :** API key avec solde suffisant
**Body :**
```json
{
  "model": "casperhansen/deepseek-r1-distill-llama-70b-awq",
  "messages": [{"role":"user","content":"Reply with exactly: PONG"}],
  "max_tokens": 20,
  "stream": false
}
```
**Assertions :**
- Status 200
- Body contient `choices[0].message.content` (non-vide)
- Body contient `usage.prompt_tokens > 0`
- Si `credits_charged` présent dans body → valeur `> 0`
**Objectif :** valide le happy path complet pour les 4 modèles direct vLLM.

**Variante :** paramétrer ce test sur les 4 modèles directs (`casperhansen/deepseek-r1-distill-llama-70b-awq`, `Qwen/Qwen3-32B-AWQ`, `btbtyler09/Devstral-Small-2507-AWQ`, `casperhansen/llama-3.3-70b-instruct-awq`).

---

### TC-08 | Chat branded o3c — proxy litellm [P1]

**Endpoint :** `POST /api/v1/chat/completions`
**Auth :** API key avec solde
**Body :**
```json
{
  "model": "o3c-auto",
  "messages": [{"role":"user","content":"Reply with exactly: PONG"}],
  "max_tokens": 20,
  "stream": false
}
```
**Assertions :**
- Status 200 (ou 503 si litellm-o3c down — test doit logger le cas sans fail bloquant)
- Body `choices[0].message.content` non-vide
**Objectif :** valide le routage branded → litellm-o3c.

---

### TC-09 | Crédits — solde via session Clerk [P1]

**Endpoint :** `GET /api/credits/balance`
**Auth :** session cookie Clerk (header `Cookie: __session=...`)
**Assertions :**
- Status 200
- Body `{ balance: <number>, lastUpdated: <iso-string> }`
- `balance >= 0`

**Note d'implémentation :** dans Playwright APIRequestContext, stocker le cookie de session Clerk
d'un compte test dédié. Obtenu une fois manuellement via `playwright codegen` ou login headful,
puis exporté dans `.env.test` (`E2E_CLERK_SESSION_COOKIE`).

**Fallback sans cookie :**
- Status 401
- Body `{ error: "Unauthorized" }`
→ Tester aussi ce cas négatif en TC-09b.

---

### TC-10 | Stripe checkout — initiation de session [P1]

**Endpoint :** `POST /api/stripe/checkout`
**Auth :** session cookie Clerk
**Body :** `{ "packageId": "starter" }`
**Assertions :**
- Status 200
- Body contient `url` (string, commence par `https://checkout.stripe.com/`)
- Body contient `sessionId` (string, commence par `cs_`)
**Objectif :** confirme que Stripe Checkout est initialisé correctement, sans compléter le paiement.

**Fallback sans cookie :**
- Status 401 — tester en TC-10b.

---

## Structure de fichiers proposée

```
o3c-tandemn-frontend/
├── e2e/
│   ├── fixtures/
│   │   └── api.fixture.ts      # APIRequestContext avec headers communs
│   ├── health.spec.ts          # TC-01
│   ├── models.spec.ts          # TC-02, TC-03
│   ├── chat.spec.ts            # TC-04, TC-05, TC-06, TC-07, TC-08
│   ├── credits.spec.ts         # TC-09, TC-09b
│   └── stripe.spec.ts          # TC-10, TC-10b
├── playwright.config.ts        # config CI-first, no browser
└── .env.test                   # E2E_API_KEY, E2E_ZERO_BALANCE_API_KEY, E2E_CLERK_SESSION_COOKIE
```

---

## Commandes

### Installation

```bash
cd /home/cloudcli/workspace/o3c-tandemn-frontend
npm install --save-dev @playwright/test
# Pas besoin des browsers pour les tests API-only :
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npx playwright install
```

### Exécution

```bash
# Tous les tests E2E contre prod
npm run test:e2e

# Un seul fichier
npx playwright test e2e/health.spec.ts

# Avec report CI (JUnit XML)
npx playwright test --reporter=junit --output-file=e2e-results.xml

# Verbose (affiche chaque request/response)
npx playwright test --reporter=list
```

### Ajouter dans `package.json`

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ci": "playwright test --reporter=junit"
  }
}
```

---

## Fichiers de config

### `playwright.config.ts` (base)

```typescript
// Source: @playwright/test official docs
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
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
  // Ne pas télécharger de browser — API mode uniquement
  projects: [
    { name: 'api', use: { browserName: 'chromium' } },
  ],
});
```

### `e2e/fixtures/api.fixture.ts` (pattern de base)

```typescript
// Source: @playwright/test APIRequestContext docs
import { test as base, APIRequestContext } from '@playwright/test';

type ApiFixtures = {
  authedApi: APIRequestContext;
  noAuthApi: APIRequestContext;
};

export const test = base.extend<ApiFixtures>({
  authedApi: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: process.env.E2E_BASE_URL ?? 'https://platform.ori3com.cloud',
      extraHTTPHeaders: {
        Authorization: `Bearer ${process.env.E2E_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    await use(ctx);
    await ctx.dispose();
  },
  noAuthApi: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: process.env.E2E_BASE_URL ?? 'https://platform.ori3com.cloud',
    });
    await use(ctx);
    await ctx.dispose();
  },
});

export { expect } from '@playwright/test';
```

---

## GitHub Actions (CI)

```yaml
# .github/workflows/e2e.yml
name: E2E API Tests
on:
  push:
    branches: [main, master]
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npx playwright install
      - name: Run E2E tests
        env:
          E2E_BASE_URL: https://platform.ori3com.cloud
          E2E_API_KEY: ${{ secrets.E2E_API_KEY }}
          E2E_ZERO_BALANCE_API_KEY: ${{ secrets.E2E_ZERO_BALANCE_API_KEY }}
          E2E_CLERK_SESSION_COOKIE: ${{ secrets.E2E_CLERK_SESSION_COOKIE }}
        run: npm run test:e2e:ci
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-results
          path: e2e-results.xml
```

---

## Contraintes et pièges

### Piège 1 : Gateway mock vs. upstream réel

Le chat handler a deux branches selon `GATEWAY_ENABLED`. En prod, la branche gateway est active
— elle utilise `db.getModelById()` (un mock in-memory) pour résoudre les modèles. Les modèles
branded (`o3c-*`) y sont connus, mais les 4 modèles vLLM directs (`casperhansen/...`) aussi.
TC-07 peut retourner une réponse mock (`"I'm processing your request"`) plutôt qu'une vraie LLM
response — les assertions ne doivent pas chercher `"PONG"` littéralement mais seulement
`choices[0].message.content` non-vide.

### Piège 2 : Clerk session cookie pour TC-09 et TC-10

`/api/credits/balance` et `/api/stripe/checkout` utilisent `auth()` de Clerk, qui lit un cookie
`__session` signé. Il n'existe pas de moyen public d'obtenir ce cookie sans un login headful
réel. Solution recommandée : une fois, faire `npx playwright codegen https://platform.ori3com.cloud`
pour capturer le cookie, le stocker dans le secret CI `E2E_CLERK_SESSION_COOKIE`.
Le cookie expire — prévoir un refresh périodique ou un compte de service avec long-lived session.

### Piège 3 : TC-06 (402) nécessite un compte à $0 permanent

Ne jamais recharger le compte `e2e-penniless`. Documenter ce compte dans les secrets CI et dans
`.planning/e2e/test-accounts.md`.

### Piège 4 : SSE streaming

Si on veut tester `stream: true`, Playwright's `response.body()` renvoie tout le buffer SSE après
fermeture de la connexion. Pour les tests de base, utiliser `stream: false`. Pour valider que
le streaming ne casse pas le parse, un test dédié peut lire le buffer et vérifier la présence
de lignes `data: {"choices":...}`.

### Piège 5 : 18 modèles côté `/api/v1/models` vs 4 côté chat

L'endpoint `/api/v1/models` retourne les 18 modèles (branded + directs) depuis litellm-o3c.
Le handler `/api/v1/chat/completions` en mode gateway ne connaît que les modèles dans `db`
(mock). TC-02 et TC-07/TC-08 testent deux sources de vérité différentes.

---

## Variables d'environnement requises pour les tests

| Variable | Usage | Source |
|----------|-------|--------|
| `E2E_BASE_URL` | Base URL du déploiement | `https://platform.ori3com.cloud` par défaut |
| `E2E_API_KEY` | Clé API avec solde positif | Créée dans l'UI platform, stockée dans CI secrets |
| `E2E_ZERO_BALANCE_API_KEY` | Clé API avec solde $0 | Compte dédié, jamais rechargé |
| `E2E_CLERK_SESSION_COOKIE` | Cookie `__session` signé par Clerk | Capturé via `playwright codegen`, rafraîchi périodiquement |

---

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: curl prod]` — Live endpoint responses from `https://platform.ori3com.cloud`
- `[VERIFIED: npm registry]` — `@playwright/test` v1.63.0 published 2026-09-08, stable since 2020

### Secondary (MEDIUM confidence)
- `[ASSUMED]` — Playwright weekly download count (50M+) from training data; registry presence verified

### Tertiary (LOW confidence)
- `[ASSUMED]` — Clerk long-lived session expiry behavior — confirm in Clerk dashboard

---

## Metadata

**Research date:** 2026-09-08
**Valid until:** 2026-10-08 (Playwright releases monthly; Clerk auth behavior stable)

**Confidence breakdown:**
- Audit existant : HIGH — vérifié par exploration directe du repo et curl prod
- Recommandation outil : HIGH — @playwright/test vérifié npm registry, usage documenté
- Plan de tests (TC-01 à TC-10) : HIGH pour les endpoints vérifiés curl prod, MEDIUM pour TC-06 (dépend d'un compte test $0 à créer)
- Setup Clerk session cookie : MEDIUM — comportement des long-lived sessions ASSUMED
