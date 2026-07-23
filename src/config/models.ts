// Core 5 Models Configuration for O3C
export interface O3CModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  context_length: number;
  input_price_per_1m: number;  // Price per 1M input tokens in USD
  output_price_per_1m: number; // Price per 1M output tokens in USD
  capabilities: string[];
  max_tokens: number;
  is_available: boolean;
}

// O3C-deployed models only
export const O3C_MODELS: O3CModel[] = [
  {
    id: "casperhansen/deepseek-r1-distill-llama-70b-awq",
    name: "DeepSeek R1 Distilled Llama 70B (AWQ)",
    provider: "O3C",
    description: "DeepSeek R1 Distill Llama 70B is a distilled large language model based on Llama-3.3-70B-Instruct, using outputs from DeepSeek R1. The model combines advanced distillation techniques to achieve high performance across multiple benchmarks, including: AIME 2024 pass@1: 70., MATH-500 pass@1: 94.5, CodeForces Rating: 1633. ",
    context_length: 8192,
    input_price_per_1m: 0.026,
    output_price_per_1m: 0.104,
    capabilities: ["text", "reasoning", "coding", "analysis"],
    max_tokens: 2000,
    is_available: true
  },
  {
    id: "Qwen/Qwen3-32B-AWQ",
    name: "Qwen3 32B (AWQ)",
    provider: "O3C", 
    description: "Qwen3-32B is a dense 32.8B parameter causal language model from the Qwen3 series, optimized for both complex reasoning and efficient dialogue. It supports seamless switching between a thinking mode for tasks like math, coding, and logical inference, and a non-thinking mode for faster, general-purpose conversation. ",
    context_length: 8192,
    input_price_per_1m: 0.018,
    output_price_per_1m: 0.072,
    capabilities: ["coding", "debugging", "code-review", "programming"],
    max_tokens: 2000,
    is_available: true
  },
  {
    id: "btbtyler09/Devstral-Small-2507-AWQ",
    name: "Devstral Small 2507 (AWQ)",
    provider: "O3C",
    description: "Devstral-Small-2507 is a 24B parameter agentic LLM fine-tuned from Mistral-Small-3.1, jointly developed by Mistral AI and All Hands AI for advanced software engineering tasks. It is optimized for codebase exploration, multi-file editing, and integration into coding agents, achieving state-of-the-art results on SWE-Bench Verified (46.8%). ",
    context_length: 8192,
    input_price_per_1m: 0.02,
    output_price_per_1m: 0.08,
    capabilities: ["text", "reasoning", "coding", "fast-inference", "agentic"],
    max_tokens: 2000,
    is_available: true
  },
  {
    id: "casperhansen/llama-3.3-70b-instruct-awq",
    name: "Llama 3.3 70B Instruct (AWQ)",
    provider: "O3C",
    description: "The Meta Llama 3.3 multilingual large language model (LLM) is a pretrained and instruction tuned generative model in 70B (text in/text out). The Llama 3.3 instruction tuned text only model is optimized for multilingual dialogue use cases and outperforms many of the available open source and closed chat models on common industry benchmarks. ",
    context_length: 8192,
    input_price_per_1m: 0.038,
    output_price_per_1m: 0.12,
    capabilities: ["text", "reasoning", "coding", "fast-inference", "multilingual"],
    max_tokens: 2000,
    is_available: true  // Now working!
  }
];

// Helper functions
export function getModelById(modelId: string): O3CModel | undefined {
  return O3C_MODELS.find(model => model.id === modelId);
}

export function calculateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Model ${modelId} not found`);
  }
  
  const inputCost = (inputTokens / 1000000) * model.input_price_per_1m;
  const outputCost = (outputTokens / 1000000) * model.output_price_per_1m;
  const totalCost = inputCost + outputCost;
  
  // Return exact cost with full precision (no rounding)
  return totalCost;
}

export function getAllModels(): O3CModel[] {
  return O3C_MODELS.filter(model => model.is_available);
}

export function getModelPricing() {
  return O3C_MODELS.map(model => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    input_price_per_1m: model.input_price_per_1m,
    output_price_per_1m: model.output_price_per_1m,
    context_length: model.context_length
  }));
}