import mongoose, { Document, Schema } from 'mongoose';

export interface IUserTransaction extends Document {
  _id: string;
  userId: string; // MongoDB UserAccount _id
  clerkUserId: string; // Clerk user ID for easy reference
  type: 'usage_charge' | 'credit_purchase' | 'bonus_credit' | 'refund';
  amount: number; // Positive for credits added, negative for credits used
  description: string;
  status: 'completed' | 'pending' | 'failed';
  modelId?: string; // For usage transactions
  tokens?: number; // Tokens consumed (for usage)
  metadata?: {
    stripePaymentId?: string;
    sessionId?: string;
    roomId?: string;
    messageId?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cost?: number;
    backend?: 'o3c' | 'openrouter' | 'mock';
    processingTime?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserTransactionSchema = new Schema<IUserTransaction>({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  clerkUserId: {
    type: String,
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['usage_charge', 'credit_purchase', 'bonus_credit', 'refund'],
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed'],
    default: 'completed',
    required: true,
  },
  modelId: {
    type: String,
    index: true,
  },
  tokens: {
    type: Number,
  },
  metadata: {
    stripePaymentId: String,
    sessionId: String,
    roomId: String,
    messageId: String,
    inputTokens: Number,
    outputTokens: Number,
    totalTokens: Number,
    cost: Number,
    backend: {
      type: String,
      enum: ['o3c', 'openrouter', 'mock'],
    },
    processingTime: Number,
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries
UserTransactionSchema.index({ userId: 1, createdAt: -1 });
UserTransactionSchema.index({ clerkUserId: 1, createdAt: -1 });
UserTransactionSchema.index({ type: 1, createdAt: -1 });
UserTransactionSchema.index({ modelId: 1, createdAt: -1 });
UserTransactionSchema.index({ createdAt: -1 });

export default mongoose.models.UserTransaction || mongoose.model<IUserTransaction>('UserTransaction', UserTransactionSchema);
