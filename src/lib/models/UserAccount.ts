import mongoose, { Document, Schema } from 'mongoose';

export interface IUserAccount extends Document {
  _id: string;
  clerkUserId: string; // Reference to Clerk user ID
  email: string;
  credits: number;
  lastCreditUpdate?: Date;
  litellmVirtualKey?: string; // Virtual key in litellm-o3c for per-user spend tracking
  preferences?: {
    theme?: 'light' | 'dark';
    notifications?: boolean;
    language?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserAccountSchema = new Schema<IUserAccount>({
  clerkUserId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    index: true,
  },
  credits: {
    type: Number,
    required: true,
    default: 20.00, // $20 default balance
  },
  lastCreditUpdate: {
    type: Date,
  },
  litellmVirtualKey: {
    type: String,
    index: true,
  },
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark'],
      default: 'light',
    },
    notifications: {
      type: Boolean,
      default: true,
    },
    language: {
      type: String,
      default: 'en',
    },
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries (single field indexes for clerkUserId and email already defined in schema)
UserAccountSchema.index({ credits: 1 });
UserAccountSchema.index({ createdAt: -1 });

export default mongoose.models.UserAccount || mongoose.model<IUserAccount>('UserAccount', UserAccountSchema);
