export type Provider = 'openai' | 'anthropic' | 'gemini' | 'timeweb' | 'custom';

export type ModelConfig = {
  id: string;
  displayName: string;
  provider: Provider;
  modelId: string;
  baseUrl?: string | null;
  apiKey?: string;
  maskedKey?: string;
  inputPrice: number | null;
  outputPrice: number | null;
  priceUnit: 1 | 1000 | 1000000;
  currency: string;
};

export type ResultStatus = 'idle' | 'streaming' | 'done' | 'error' | 'cancelled';
export type AiEvaluation = {
  evaluator: string;
  relevance: number;
  completeness: number;
  clarity: number;
  reasoning: number;
  explanation: string;
};

export type ModelResult = {
  id: string;
  modelConfigId: string;
  modelName: string;
  provider: Provider;
  modelId: string;
  inputPrice: number | null;
  outputPrice: number | null;
  priceUnit: number;
  currency: string;
  response: string;
  status: ResultStatus;
  error?: string;
  firstTokenMs?: number | null;
  totalMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokenEstimated?: boolean;
  cost?: number | null;
  liked?: boolean | null;
  rating?: number | null;
  isWinner?: boolean;
  firstStarted?: boolean;
  firstFinished?: boolean;
  aiEvaluation?: AiEvaluation;
};

export type Comparison = { id: string; prompt: string; createdAt: string; results: ModelResult[] };
export type Chat = { id: string; title: string; createdAt: string; updatedAt: string; comparisons: Comparison[] };
export type ChatSummary = Pick<Chat, 'id' | 'title' | 'createdAt' | 'updatedAt'>;
export type User = { id: string; name: string; email: string; isAdmin: boolean };

export type AnalyticsRow = {
  id: string; model_name: string; provider: Provider; prompt: string; chatId: string; response: string;
  first_token_ms: number | null; total_ms: number | null; input_tokens: number | null; output_tokens: number | null;
  token_estimated: number; cost: number | null; currency: string | null; liked: number | null; rating: number | null;
  is_winner: number; ai_evaluation: string | null; created_at: string; status: string;
};
