// O3C Platform — catalogue complet des modèles exposés via api.ori3com.cloud
// Source de vérité : o3c-chat/litellm-proxy/config.yaml (commentaires de tier = authoritative)
// Pricing = tarif plateforme (pas coût fournisseur) — mis à jour manuellement si besoin

export type ModelTier = 'free' | 'starter' | 'pro' | 'business';

export interface TandemnModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  context_length: number;
  input_price_per_1m: number;
  output_price_per_1m: number;
  capabilities: string[];
  max_tokens: number;
  is_available: boolean;
  tier: ModelTier;               // tier minimum requis pour accéder au modèle
  routing: 'litellm' | 'direct'; // litellm = via api.ori3com.cloud, direct = AWS vLLM
}

// ── Catalogue o3c-branded (via api.ori3com.cloud / litellm-o3c) ───────────────

const O3C_BRANDED_MODELS: TandemnModel[] = [
  // ── FREE ──────────────────────────────────────────────────────────────────
  {
    id: 'o3c-mini',
    name: 'O3C Mini',
    provider: 'O3C',
    description: 'Modèle léger et économique pour des tâches conversationnelles simples. Idéal pour les intégrations haute fréquence.',
    context_length: 128000,
    input_price_per_1m: 0.01,
    output_price_per_1m: 0.02,
    capabilities: ['text', 'fast-inference'],
    max_tokens: 4096,
    is_available: true,
    tier: 'free',
    routing: 'litellm',
  },
  {
    id: 'o3c-fast',
    name: 'O3C Fast',
    provider: 'O3C',
    description: 'Inférence ultra-rapide (Cerebras silicon). Parfait pour les applications temps-réel et le streaming.',
    context_length: 128000,
    input_price_per_1m: 0.015,
    output_price_per_1m: 0.03,
    capabilities: ['text', 'fast-inference', 'coding'],
    max_tokens: 8192,
    is_available: true,
    tier: 'free',
    routing: 'litellm',
  },
  {
    id: 'o3c-rapide',
    name: 'O3C Rapide',
    provider: 'O3C',
    description: 'Réponses rapides toutes tâches (chat, résumé, classification). Basse latence garantie.',
    context_length: 1000000,
    input_price_per_1m: 0.012,
    output_price_per_1m: 0.025,
    capabilities: ['text', 'fast-inference', 'multilingual'],
    max_tokens: 8192,
    is_available: true,
    tier: 'free',
    routing: 'litellm',
  },
  {
    id: 'o3c-souverain',
    name: 'O3C Souverain',
    provider: 'O3C',
    description: 'Modèle open-weight souverain (Mistral/Codestral). Optimisé pour le code et le français.',
    context_length: 256000,
    input_price_per_1m: 0.015,
    output_price_per_1m: 0.04,
    capabilities: ['text', 'coding', 'multilingual', 'french'],
    max_tokens: 8192,
    is_available: true,
    tier: 'free',
    routing: 'litellm',
  },
  // ── STARTER ───────────────────────────────────────────────────────────────
  {
    id: 'o3c-equilibre',
    name: 'O3C Équilibré',
    provider: 'O3C',
    description: 'Le meilleur rapport qualité/coût pour les tâches générales — raisonnement, analyse, code intermédiaire.',
    context_length: 128000,
    input_price_per_1m: 0.02,
    output_price_per_1m: 0.06,
    capabilities: ['text', 'reasoning', 'coding', 'analysis'],
    max_tokens: 8192,
    is_available: true,
    tier: 'starter',
    routing: 'litellm',
  },
  {
    id: 'o3c-glm',
    name: 'O3C GLM',
    provider: 'O3C',
    description: 'Spécialiste multilingue (GLM-5.2) — excellent en chinois, japonais, coréen et langues européennes.',
    context_length: 128000,
    input_price_per_1m: 0.018,
    output_price_per_1m: 0.05,
    capabilities: ['text', 'multilingual', 'chinese', 'reasoning'],
    max_tokens: 8192,
    is_available: true,
    tier: 'starter',
    routing: 'litellm',
  },
  {
    id: 'o3c-auto',
    name: 'O3C Auto',
    provider: 'O3C',
    description: 'Routeur intelligent — classe automatiquement votre requête (SIMPLE/MEDIUM/COMPLEX/REASONING) et sélectionne le modèle optimal.',
    context_length: 128000,
    input_price_per_1m: 0.025,
    output_price_per_1m: 0.07,
    capabilities: ['text', 'auto-routing', 'reasoning', 'coding', 'analysis'],
    max_tokens: 8192,
    is_available: true,
    tier: 'starter',
    routing: 'litellm',
  },
  // ── PRO ───────────────────────────────────────────────────────────────────
  {
    id: 'o3c-avance',
    name: 'O3C Avancé',
    provider: 'O3C',
    description: 'Modèle avancé (MiniMax-M2.7 + NVIDIA frontier). Instructions complexes, analyse longue, rédaction professionnelle.',
    context_length: 1000000,
    input_price_per_1m: 0.04,
    output_price_per_1m: 0.12,
    capabilities: ['text', 'reasoning', 'coding', 'analysis', 'long-context'],
    max_tokens: 16384,
    is_available: true,
    tier: 'pro',
    routing: 'litellm',
  },
  {
    id: 'o3c-code',
    name: 'O3C Code',
    provider: 'O3C',
    description: 'Spécialiste code et agents (Kimi K3 + Stepfun). SWE-bench A+, tool-calling, exploration de codebase.',
    context_length: 128000,
    input_price_per_1m: 0.035,
    output_price_per_1m: 0.10,
    capabilities: ['coding', 'debugging', 'agentic', 'tool-calling', 'code-review'],
    max_tokens: 16384,
    is_available: true,
    tier: 'pro',
    routing: 'litellm',
  },
  {
    id: 'o3c-reason',
    name: 'O3C Reason',
    provider: 'O3C',
    description: 'Modèle de raisonnement (Kimi K3 + Nemotron 550B). Mathématiques, logique, problèmes multi-étapes.',
    context_length: 128000,
    input_price_per_1m: 0.04,
    output_price_per_1m: 0.12,
    capabilities: ['reasoning', 'math', 'analysis', 'coding', 'step-by-step'],
    max_tokens: 16384,
    is_available: true,
    tier: 'pro',
    routing: 'litellm',
  },
  {
    id: 'o3c-kimi',
    name: 'O3C Kimi',
    provider: 'O3C',
    description: 'Kimi K3 direct — meilleur en outil-calling et agents. Garantit le modèle, sans routage alternatif.',
    context_length: 128000,
    input_price_per_1m: 0.04,
    output_price_per_1m: 0.12,
    capabilities: ['coding', 'tool-calling', 'agentic', 'reasoning', 'json-mode'],
    max_tokens: 16384,
    is_available: true,
    tier: 'pro',
    routing: 'litellm',
  },
  // ── BUSINESS ──────────────────────────────────────────────────────────────
  {
    id: 'o3c-expert',
    name: 'O3C Expert',
    provider: 'O3C',
    description: 'Frontier S+ (Nemotron 550B Ultra / MiniMax-M2.7). Tâches les plus complexes, score MMLU/MATH de rang S.',
    context_length: 1000000,
    input_price_per_1m: 0.08,
    output_price_per_1m: 0.24,
    capabilities: ['text', 'reasoning', 'analysis', 'coding', 'multilingual', 'long-context'],
    max_tokens: 32768,
    is_available: true,
    tier: 'business',
    routing: 'litellm',
  },
  {
    id: 'o3c-reason-max',
    name: 'O3C Reason Max',
    provider: 'O3C',
    description: 'Raisonnement profond avec temps de réflexion étendu (MiniMax-M3 + Nemotron 550B). Maths olympiques, recherche.',
    context_length: 1000000,
    input_price_per_1m: 0.08,
    output_price_per_1m: 0.24,
    capabilities: ['deep-reasoning', 'math', 'analysis', 'research', 'long-context'],
    max_tokens: 32768,
    is_available: true,
    tier: 'business',
    routing: 'litellm',
  },
  {
    id: 'o3c-long',
    name: 'O3C Long',
    provider: 'O3C',
    description: 'Contexte étendu (MiniMax-M3 — 1M+ tokens). Analyse de documents longs, bases de code entières, rapports.',
    context_length: 1000000,
    input_price_per_1m: 0.06,
    output_price_per_1m: 0.18,
    capabilities: ['long-context', 'text', 'analysis', 'multilingual', 'document-processing'],
    max_tokens: 32768,
    is_available: true,
    tier: 'business',
    routing: 'litellm',
  },
  // ── EMBEDDINGS ────────────────────────────────────────────────────────────
  {
    id: 'embedding-pro',
    name: 'O3C Embedding Pro',
    provider: 'O3C',
    description: 'Embeddings haute qualité (text-embedding-3-small OpenAI). Pour RAG, recherche sémantique, clustering.',
    context_length: 8191,
    input_price_per_1m: 0.02,
    output_price_per_1m: 0,
    capabilities: ['embeddings', 'semantic-search', 'rag'],
    max_tokens: 8191,
    is_available: true,
    tier: 'starter',
    routing: 'litellm',
  },
];

// ── Modèles directs (AWS vLLM — routing direct, sans litellm) ─────────────────

const DIRECT_MODELS: TandemnModel[] = [
  {
    id: 'casperhansen/deepseek-r1-distill-llama-70b-awq',
    name: 'DeepSeek R1 Distilled Llama 70B (AWQ)',
    provider: 'O3C Direct',
    description: 'DeepSeek R1 distillé sur Llama-3.3-70B. AIME 2024: 70%, MATH-500: 94.5%. Raisonnement et code.',
    context_length: 8192,
    input_price_per_1m: 0.026,
    output_price_per_1m: 0.104,
    capabilities: ['text', 'reasoning', 'coding', 'analysis', 'math'],
    max_tokens: 2000,
    is_available: true,
    tier: 'pro',
    routing: 'direct',
  },
  {
    id: 'Qwen/Qwen3-32B-AWQ',
    name: 'Qwen3 32B (AWQ)',
    provider: 'O3C Direct',
    description: 'Qwen3-32B dense, mode thinking switchable. Coding, logique, dialogue général.',
    context_length: 8192,
    input_price_per_1m: 0.018,
    output_price_per_1m: 0.072,
    capabilities: ['coding', 'debugging', 'code-review', 'reasoning'],
    max_tokens: 2000,
    is_available: true,
    tier: 'starter',
    routing: 'direct',
  },
  {
    id: 'btbtyler09/Devstral-Small-2507-AWQ',
    name: 'Devstral Small 2507 (AWQ)',
    provider: 'O3C Direct',
    description: 'Mistral-Small-3.1 fine-tuné pour agents logiciels. SWE-Bench: 46.8%. Exploration codebase, multi-fichiers.',
    context_length: 8192,
    input_price_per_1m: 0.02,
    output_price_per_1m: 0.08,
    capabilities: ['coding', 'agentic', 'debugging', 'tool-calling', 'code-review'],
    max_tokens: 2000,
    is_available: true,
    tier: 'starter',
    routing: 'direct',
  },
  {
    id: 'casperhansen/llama-3.3-70b-instruct-awq',
    name: 'Llama 3.3 70B Instruct (AWQ)',
    provider: 'O3C Direct',
    description: 'Meta Llama 3.3 70B multilingue. Optimisé dialogue, outperforme de nombreux modèles fermés sur benchmarks.',
    context_length: 8192,
    input_price_per_1m: 0.038,
    output_price_per_1m: 0.12,
    capabilities: ['text', 'reasoning', 'coding', 'fast-inference', 'multilingual'],
    max_tokens: 2000,
    is_available: true,
    tier: 'starter',
    routing: 'direct',
  },
];

// ── Catalogue complet ─────────────────────────────────────────────────────────

export const TANDEMN_MODELS: TandemnModel[] = [...O3C_BRANDED_MODELS, ...DIRECT_MODELS];

// Helper functions
export function getModelById(modelId: string): TandemnModel | undefined {
  return TANDEMN_MODELS.find(m => m.id === modelId);
}

export function getAllModels(): TandemnModel[] {
  return TANDEMN_MODELS.filter(m => m.is_available);
}

export function getModelsForTier(tier: ModelTier): TandemnModel[] {
  const order: ModelTier[] = ['free', 'starter', 'pro', 'business'];
  const tierIdx = order.indexOf(tier);
  return TANDEMN_MODELS.filter(m => m.is_available && order.indexOf(m.tier) <= tierIdx);
}

export function calculateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const model = getModelById(modelId);
  // Unknown model → fallback to o3c-equilibre pricing (conservative estimate)
  const input_price = model?.input_price_per_1m ?? 0.025;
  const output_price = model?.output_price_per_1m ?? 0.07;
  return (inputTokens / 1_000_000) * input_price + (outputTokens / 1_000_000) * output_price;
}

export function getModelPricing() {
  return TANDEMN_MODELS.map(m => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    input_price_per_1m: m.input_price_per_1m,
    output_price_per_1m: m.output_price_per_1m,
    context_length: m.context_length,
    tier: m.tier,
  }));
}
