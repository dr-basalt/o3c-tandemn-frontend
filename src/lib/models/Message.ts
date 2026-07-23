import mongoose, { Document, Schema } from 'mongoose';
import { EncryptedData } from '../encryption';

export interface IMessage extends Document {
  _id: string;
  conversationId: string; // Reference to conversation
  userId: string; // Clerk user ID - for access control
  userIdHash: string; // Hashed user ID for indexing
  role: 'user' | 'assistant' | 'system';
  content: EncryptedData; // Encrypted message content
  modelId?: string; // Model used for assistant responses
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  };
  metadata?: {
    backend?: 'o3c' | 'openrouter' | 'mock';
    processingTime?: number;
    temperature?: number;
    maxTokens?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>({
  conversationId: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  userIdHash: {
    type: String,
    required: true,
    index: true,
  },
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true,
  },
  content: {
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    data: { type: String, required: true },
  },
  modelId: {
    type: String,
    index: true,
  },
  tokenUsage: {
    inputTokens: Number,
    outputTokens: Number,
    totalTokens: Number,
    cost: Number,
  },
  metadata: {
    backend: {
      type: String,
      enum: ['o3c', 'openrouter', 'mock'],
    },
    processingTime: Number,
    temperature: Number,
    maxTokens: Number,
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries
MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ userId: 1, createdAt: -1 });
MessageSchema.index({ userIdHash: 1, conversationId: 1, createdAt: 1 });

export default mongoose.models.Message || mongoose.model<IMessage>('Message', MessageSchema);