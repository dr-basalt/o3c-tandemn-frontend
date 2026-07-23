export type Model = {
  id: string;               // "google/gemini-2.5-pro"
  vendor: string;           // "google"
  series: 'GPT' | 'Claude' | 'Gemini' | 'Mistral' | 'Llama' | 'DeepSeek' | 'Qwen' | 'Phi' | 'Other';
  name: string;             // "Gemini 2.5 Pro"
  short: string;            // "gemini-2.5-pro"
  context: number;          // tokens
  promptPrice: number;      // $ per 1M input tokens
  completionPrice: number;  // $ per 1M output tokens
  tokensPerWeek: number;    // popularity stat
  latencyMs: number;
  weeklyGrowthPct?: number;
  modalities: ('text' | 'image' | 'file' | 'audio')[];
  description: string;
  badges?: string[];
};

export type ChatRoom = {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  userId?: string;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  roomId: string;
  backend?: 'o3c' | 'openrouter' | 'mock';
};

export type KPIStats = {
  monthlyTokens: string;
  users: string;
  providers: number;
  models: number;
};

export type FeaturedData = {
  featured: Model[];
  kpis: KPIStats;
};

export type ModelsResponse = {
  items: Model[];
  page: number;
  total: number;
  hasMore: boolean;
};

export type RankingModel = {
  id: string;
  name: string;
  vendor: string;
  latencyMs: number;
  tokensPerWeek: number;
  weeklyGrowthPct?: number;
};

export type ChatStreamChunk = {
  text: string;
  done: boolean;
};

export type ModelsFilter = {
  q?: string;
  modalities?: string[];
  series?: string[];
  contextMin?: number;
  contextMax?: number;
  promptPriceMax?: number;
  sort?: 'popularity' | 'latency' | 'priceLow' | 'priceHigh' | 'name';
  view?: 'list' | 'grid';
  page?: number;
  limit?: number;
};

export type User = {
  id: string;
  name: string;
  email: string;
  image?: string;
  credits: number;
};

export type Transaction = {
  id: string;
  userId: string;
  type: 'purchase' | 'usage' | 'refund' | 'bonus';
  amount: number; // positive for credits added, negative for credits used
  description: string;
  modelId?: string; // for usage transactions
  tokens?: number; // tokens consumed (for usage)
  metadata?: {
    stripePaymentId?: string;
    sessionId?: string;
    roomId?: string;
    messageId?: string;
  };
  createdAt: string;
};

export type Usage = {
  id: string;
  userId: string;
  modelId: string;
  roomId?: string;
  messageId?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number; // in credits
  createdAt: string;
};

export type CreditBalance = {
  userId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  lastUpdated: string;
};
