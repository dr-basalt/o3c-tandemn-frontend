import mongoose from 'mongoose';

export interface IChatResponse {
  userId: string;
  modelId: string;
  roomId?: string;
  messageId?: string;
  inputText: string;
  responseText: string;
  backendUsed: 'o3c' | 'openrouter' | 'mock';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  processingTimeMs: number;
  timestamp: Date;
  metadata?: {
    modelVendor?: string;
    modelName?: string;
    requestId?: string;
    error?: string;
  };
}

const ChatResponseSchema = new mongoose.Schema<IChatResponse>({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  modelId: {
    type: String,
    required: true,
    index: true,
  },
  roomId: {
    type: String,
    index: true,
  },
  messageId: {
    type: String,
  },
  inputText: {
    type: String,
    required: true,
  },
  responseText: {
    type: String,
    required: true,
  },
  backendUsed: {
    type: String,
    enum: ['o3c', 'openrouter', 'mock'],
    required: true,
    index: true,
  },
  inputTokens: {
    type: Number,
    required: true,
  },
  outputTokens: {
    type: Number,
    required: true,
  },
  totalTokens: {
    type: Number,
    required: true,
  },
  inputCost: {
    type: Number,
    required: true,
  },
  outputCost: {
    type: Number,
    required: true,
  },
  totalCost: {
    type: Number,
    required: true,
  },
  processingTimeMs: {
    type: Number,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  metadata: {
    modelVendor: String,
    modelName: String,
    requestId: String,
    error: String,
  },
});

// Create compound indexes for common queries
ChatResponseSchema.index({ userId: 1, timestamp: -1 });
ChatResponseSchema.index({ modelId: 1, timestamp: -1 });
ChatResponseSchema.index({ backendUsed: 1, timestamp: -1 });
ChatResponseSchema.index({ timestamp: -1 });

export default mongoose.models.ChatResponse || mongoose.model<IChatResponse>('ChatResponse', ChatResponseSchema);
