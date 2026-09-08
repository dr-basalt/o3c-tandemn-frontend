import { createClerkClient } from '@clerk/nextjs/server';
import { auth } from '@clerk/nextjs/server';
import { cache, CacheKeys, CacheTTL } from './cache';
import { withRateLimit, Priority } from './rate-limiter';
import { withClerkRetry } from './retry';
import dbConnect from './database';
import UserAccount, { IUserAccount } from './models/UserAccount';
import UserTransaction from './models/UserTransaction';
import UserAPIKey from './models/UserAPIKey';
import { createHash, randomBytes } from 'crypto';
import { calculateCost } from '@/config/models';
import { createLitellmVirtualKey, deleteLitellmVirtualKey } from './litellm-admin';


const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

export interface APIKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  isActive: boolean;
  lastUsed?: string;
  usageCount: number;
}

export interface Transaction {
  id: string;
  type: 'usage_charge' | 'credit_purchase' | 'bonus_credit' | 'refund';
  amount: number;
  description: string;
  status: 'completed' | 'pending' | 'failed';
  modelId?: string;
  tokens?: number;
  metadata?: any;
  createdAt: string;
}

// Get or create user account in MongoDB
export async function getUserAccount(clerkUserId?: string): Promise<IUserAccount | null> {
  try {
    const userIdToUse = clerkUserId || (await auth()).userId;
    if (!userIdToUse) return null;

    await dbConnect();

    // Check cache first
    const cacheKey = CacheKeys.userMetadata(userIdToUse);
    const cachedAccount = cache.get<IUserAccount>(cacheKey);
    if (cachedAccount) {
      return cachedAccount;
    }

    // Try to find existing account
    let account = await UserAccount.findOne({ clerkUserId: userIdToUse });

    if (!account) {
      // Create new account if it doesn't exist
      const clerkUser = await clerkClient.users.getUser(userIdToUse);
      account = new UserAccount({
        clerkUserId: userIdToUse,
        email: clerkUser.emailAddresses[0]?.emailAddress || '',
        credits: 20.00, // Default balance
      });
      await account.save();
      
      // Record initial credit grant as a transaction
      const newTransaction = new UserTransaction({
        userId: account._id.toString(),
        clerkUserId: userIdToUse,
        type: 'bonus_credit',
        amount: 20.00,
        description: 'Welcome bonus credits',
        status: 'completed',
      });
      await newTransaction.save();
    }

    // Cache the result
    cache.set(cacheKey, account, CacheTTL.USER_METADATA);
    return account;
  } catch (error) {
    console.error('Error getting user account:', error);
    return null;
  }
}

// Get user's current credit balance
export async function getUserCredits(userId?: string): Promise<number> {
  try {
    const userIdToUse = userId || (await auth()).userId;
    if (!userIdToUse) return 0;

    // Load testing bypass
    if (process.env.NODE_ENV === 'development' && userIdToUse === 'test-user-loadtest') {
      return 10000;
    }

    // Check cache first
    const cacheKey = CacheKeys.userCredits(userIdToUse);
    const cachedCredits = cache.get<number>(cacheKey);
    if (cachedCredits !== null) {
      return cachedCredits;
    }

    const account = await getUserAccount(userIdToUse);
    const credits = account?.credits || 20.00;

    // Cache the result
    cache.set(cacheKey, credits, CacheTTL.USER_CREDITS);
    return credits;
  } catch (error) {
    console.error('Error getting user credits:', error);
    return 20.00;
  }
}

// Add credits to user's account
export async function addCredits(userId: string, amount: number): Promise<boolean> {
  try {
    await dbConnect();
    
    const account = await getUserAccount(userId);
    if (!account) return false;

    const newCredits = account.credits + amount;
    
    await UserAccount.findByIdAndUpdate(account._id, {
      credits: newCredits,
      lastCreditUpdate: new Date(),
    });

    // Invalidate cache
    const cacheKey = CacheKeys.userCredits(userId);
    cache.delete(cacheKey);
    cache.delete(CacheKeys.userMetadata(userId));

    return true;
  } catch (error) {
    console.error('Error adding credits:', error);
    return false;
  }
}

// Deduct credits from user's account
export async function deductCredits(userId: string, amount: number): Promise<boolean> {
  try {
    await dbConnect();
    
    const account = await getUserAccount(userId);
    if (!account || account.credits < amount) {
      return false;
    }

    const newCredits = account.credits - amount;
    
    await UserAccount.findByIdAndUpdate(account._id, {
      credits: newCredits,
      lastCreditUpdate: new Date(),
    });

    // Invalidate cache
    const cacheKey = CacheKeys.userCredits(userId);
    cache.delete(cacheKey);
    cache.delete(CacheKeys.userMetadata(userId));

    return true;
  } catch (error) {
    console.error('Error deducting credits:', error);
    return false;
  }
}

// Get user's transaction history
export async function getTransactionHistory(userId?: string): Promise<Transaction[]> {
  try {
    const userIdToUse = userId || (await auth()).userId;
    if (!userIdToUse) return [];

    // Check cache first
    const cacheKey = CacheKeys.userTransactions(userIdToUse);
    const cachedTransactions = cache.get<Transaction[]>(cacheKey);
    if (cachedTransactions) {
      return cachedTransactions;
    }

    await dbConnect();
    
    const account = await getUserAccount(userIdToUse);
    if (!account) return [];

    const transactions = await UserTransaction.find({ userId: account._id.toString() })
      .sort({ createdAt: -1 })
      .limit(100); // Much higher limit than Clerk's 20

    const formattedTransactions: Transaction[] = transactions.map(tx => ({
      id: tx._id.toString(),
      type: tx.type,
      amount: tx.amount,
      description: tx.description,
      status: tx.status || 'completed', // Default to completed for old transactions
      modelId: tx.modelId,
      tokens: tx.tokens,
      metadata: tx.metadata,
      createdAt: tx.createdAt.toISOString(),
    }));

    // Cache the result
    cache.set(cacheKey, formattedTransactions, CacheTTL.USER_TRANSACTIONS);
    return formattedTransactions;
  } catch (error) {
    console.error('Error getting transaction history:', error);
    return [];
  }
}

// Add transaction to user's history
export async function addTransaction(userId: string, transaction: Omit<Transaction, 'id' | 'createdAt'>): Promise<void> {
  try {
    await dbConnect();
    
    const account = await getUserAccount(userId);
    if (!account) return;

    const newTransaction = new UserTransaction({
      userId: account._id.toString(),
      clerkUserId: userId,
      type: transaction.type,
      amount: transaction.amount,
      description: transaction.description,
      status: transaction.status,
      modelId: transaction.modelId,
      tokens: transaction.tokens,
      metadata: transaction.metadata,
    });

    await newTransaction.save();

    // Invalidate transaction cache
    const cacheKey = CacheKeys.userTransactions(userId);
    cache.delete(cacheKey);
  } catch (error) {
    console.error('Error adding transaction:', error);
  }
}

// Ensure the user has a litellm-o3c virtual key, creating one if needed.
// Returns the key value or null when LITELLM_MASTER_KEY is not configured.
export async function ensureLitellmKey(clerkUserId: string): Promise<string | null> {
  await dbConnect();
  const account = await getUserAccount(clerkUserId);
  if (!account) return null;

  if (account.litellmVirtualKey) return account.litellmVirtualKey;

  const virtualKey = await createLitellmVirtualKey(clerkUserId);
  if (!virtualKey) return null;

  await UserAccount.findByIdAndUpdate(account._id, { litellmVirtualKey: virtualKey });
  cache.delete(CacheKeys.userMetadata(clerkUserId));
  return virtualKey;
}

// Return the user's existing litellm virtual key (does not create one).
export async function getLitellmVirtualKey(clerkUserId: string): Promise<string | null> {
  const account = await getUserAccount(clerkUserId);
  return account?.litellmVirtualKey ?? null;
}

// Generate API key for user
export async function generateAPIKey(name: string, userId?: string): Promise<{ success: boolean; apiKey?: APIKey; litellmKey?: string; message: string }> {
  try {
    console.log('🔑 Generating API key...');
    console.log('  Name:', name);
    console.log('  UserId:', userId);
    
    const userIdToUse = userId || (await auth()).userId;
    if (!userIdToUse) {
      console.error('❌ User not authenticated');
      return { success: false, message: 'User not authenticated' };
    }

    console.log('  Authenticated userId:', userIdToUse);
    console.log('  Connecting to MongoDB...');
    await dbConnect();
    
    console.log('  Getting user account...');
    const account = await getUserAccount(userIdToUse);
    if (!account) {
      console.error('❌ User account not found');
      return { success: false, message: 'User account not found' };
    }

    console.log('  Account found:', account._id);
    console.log('  Checking existing keys...');
    
    // Check existing API keys count
    const existingKeys = await UserAPIKey.countDocuments({ userId: account._id.toString(), isActive: true });
    console.log('  Existing active keys:', existingKeys);
    
    if (existingKeys >= 5) {
      console.error('❌ Maximum keys reached');
      return { success: false, message: 'Maximum 5 API keys allowed per user' };
    }

    // Generate a secure API key
    console.log('  Generating key value...');
    const keyId = `key_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const apiKeyValue = `gk-${userIdToUse.slice(-8)}_${Math.random().toString(36).substring(2, 34)}`;
    const keyHash = createHash('sha256').update(apiKeyValue).digest('hex');
    const keyPrefix = apiKeyValue.substring(0, 8);

    console.log('  Creating API key document...');
    const newAPIKey = new UserAPIKey({
      userId: account._id.toString(),
      clerkUserId: userIdToUse,
      name,
      keyHash,
      keyPrefix,
      isActive: true,
      usageCount: 0,
    });

    console.log('  Saving API key to MongoDB...');
    await newAPIKey.save();
    console.log('✅ API key saved successfully! ID:', newAPIKey._id);

    const apiKey: APIKey = {
      id: newAPIKey._id.toString(),
      name,
      key: apiKeyValue,
      createdAt: newAPIKey.createdAt.toISOString(),
      isActive: true,
      usageCount: 0,
    };

    // Invalidate API keys cache
    cache.delete(CacheKeys.userApiKeys(userIdToUse));

    // Ensure user has a litellm-o3c virtual key (created on demand, no-op when master key not set)
    const litellmKey = await ensureLitellmKey(userIdToUse);

    console.log('✅ API key generation complete');
    return { success: true, apiKey, litellmKey: litellmKey ?? undefined, message: 'API key generated successfully' };
  } catch (error) {
    console.error('❌ Error generating API key:', error);
    console.error('Error generating API key:', error);
    return { success: false, message: 'Failed to generate API key' };
  }
}

// Get user's API keys
export async function getUserAPIKeys(userId?: string): Promise<APIKey[]> {
  try {
    const userIdToUse = userId || (await auth()).userId;
    if (!userIdToUse) return [];

    // Check cache first
    const cacheKey = CacheKeys.userApiKeys(userIdToUse);
    const cachedKeys = cache.get<APIKey[]>(cacheKey);
    if (cachedKeys) {
      return cachedKeys;
    }

    await dbConnect();
    
    const account = await getUserAccount(userIdToUse);
    if (!account) return [];

    const keys = await UserAPIKey.find({ userId: account._id.toString(), isActive: true })
      .sort({ createdAt: -1 });

    const formattedKeys: APIKey[] = keys.map(key => ({
      id: key._id.toString(),
      name: key.name,
      key: `${key.keyPrefix}...`, // Don't expose full key
      createdAt: key.createdAt.toISOString(),
      isActive: key.isActive,
      lastUsed: key.lastUsed?.toISOString(),
      usageCount: key.usageCount,
    }));

    // Cache the result
    cache.set(cacheKey, formattedKeys, CacheTTL.USER_API_KEYS);
    return formattedKeys;
  } catch (error) {
    console.error('Error getting user API keys:', error);
    return [];
  }
}

// Validate API key
export async function validateAPIKey(apiKey: string): Promise<{ valid: boolean; userId?: string; keyId?: string }> {
  try {
    await dbConnect();
    
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const key = await UserAPIKey.findOne({ keyHash, isActive: true });
    
    if (!key) {
      return { valid: false };
    }

    // Update usage stats
    await UserAPIKey.findByIdAndUpdate(key._id, {
      lastUsed: new Date(),
      usageCount: key.usageCount + 1,
    });

    return { valid: true, userId: key.clerkUserId, keyId: key._id.toString() };
  } catch (error) {
    console.error('Error validating API key:', error);
    return { valid: false };
  }
}

// Deactivate API key
export async function deactivateAPIKey(userId: string, keyId: string): Promise<boolean> {
  try {
    await dbConnect();
    
    const account = await getUserAccount(userId);
    if (!account) {
      console.error('Account not found for userId:', userId);
      return false;
    }

    console.log('Deactivating API key:', { keyId, userId, accountId: account._id.toString() });

    const result = await UserAPIKey.findOneAndUpdate(
      { _id: keyId, userId: account._id.toString() },
      { isActive: false }
    );

    if (result) {
      console.log('API key deactivated successfully:', result._id);
      // Invalidate API keys cache
      cache.delete(CacheKeys.userApiKeys(userId));

      // If the user has no more active platform keys, delete their litellm virtual key too
      const remaining = await UserAPIKey.countDocuments({ userId: account._id.toString(), isActive: true });
      if (remaining === 0 && account.litellmVirtualKey) {
        await deleteLitellmVirtualKey(account.litellmVirtualKey);
        await UserAccount.findByIdAndUpdate(account._id, { $unset: { litellmVirtualKey: '' } });
        cache.delete(CacheKeys.userMetadata(userId));
      }

      return true;
    }

    console.error('API key not found or does not belong to user:', { keyId, accountId: account._id.toString() });
    return false;
  } catch (error) {
    console.error('Error deactivating API key:', error);
    return false;
  }
}

// Give welcome credits to new user
export async function giveWelcomeCredits(userId: string): Promise<void> {
  try {
    const currentCredits = await getUserCredits(userId);
    
    // Only give welcome credits if user has no credits
    if (currentCredits === 0) {
      const welcomeCredits = 20.00;
      await addCredits(userId, welcomeCredits);
      
      await addTransaction(userId, {
        type: 'bonus_credit',
        amount: welcomeCredits,
        description: 'Welcome bonus credits',
        status: 'completed',
      });
    }
  } catch (error) {
    console.error('Error giving welcome credits:', error);
  }
}

// Charge user for API usage
export async function chargeForUsage(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  userId: string
): Promise<boolean> {
  try {
    // Calculate cost based on actual model pricing
    const cost = calculateCost(modelId, inputTokens, outputTokens);
    const totalTokens = inputTokens + outputTokens;
    
    // Deduct credits
    const success = await deductCredits(userId, cost);
    
    if (success) {
      // Add transaction record
      await addTransaction(userId, {
        type: 'usage_charge',
        amount: -cost,
        description: `API usage: ${modelId}`,
        status: 'completed',
        modelId,
        tokens: totalTokens,
        metadata: {
          inputTokens,
          outputTokens,
          cost,
        },
      });
    }
    
    return success;
  } catch (error) {
    console.error('Error charging for usage:', error);
    return false;
  }
}

// Charge credits for general usage with transaction logging
export async function chargeCredits(
  amount: number,
  description: string,
  userId: string,
  metadata?: any
): Promise<boolean> {
  try {
    // Load testing bypass - always succeed for test user
    if (process.env.NODE_ENV === 'development' && userId === 'test-user-loadtest') {
      return true; // Always successful charge for load testing
    }

    const success = await deductCredits(userId, amount);
    
    if (success) {
      await addTransaction(userId, {
        type: 'usage_charge',
        amount: -amount,
        description,
        status: 'completed',
        metadata,
      });
    }

    return success;
  } catch (error) {
    console.error('Error charging credits:', error);
    return false;
  }
}

