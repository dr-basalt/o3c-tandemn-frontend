import { NextRequest, NextResponse } from 'next/server';
import { validateAPIKey, getUserCredits, getTransactionHistory, getLitellmVirtualKey } from '@/lib/credits';
import { getLitellmKeyInfo } from '@/lib/litellm-admin';

// Force dynamic rendering - don't cache this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/v1/balance - Get user's current credit balance
export async function GET(request: NextRequest) {
  try {
    // Extract API key from Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header. Use: Authorization: Bearer YOUR_API_KEY' },
        { status: 401 }
      );
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Validate API key
    const validation = await validateAPIKey(apiKey);
    if (!validation.valid || !validation.userId) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    const userId = validation.userId;

    // Get current balance and litellm spend in parallel
    const [balance, transactions, litellmKey] = await Promise.all([
      getUserCredits(userId),
      getTransactionHistory(userId),
      getLitellmVirtualKey(userId),
    ]);

    const litellmInfo = litellmKey ? await getLitellmKeyInfo(litellmKey) : null;
    const litellmSpend = litellmInfo?.spend ?? 0;
    const recentTransactions = transactions.slice(0, 5);
    
    // Calculate usage stats for this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const monthlyTransactions = transactions.filter(tx => 
      tx.type === 'usage_charge' && new Date(tx.createdAt) >= startOfMonth
    );
    
    const monthlySpent = monthlyTransactions.reduce((total, tx) => total + Math.abs(tx.amount), 0);
    const monthlyApiCalls = monthlyTransactions.length;

    const response = NextResponse.json({
      data: {
        balance: balance,
        currency: 'USD',
        litellm_spend: litellmSpend,
        monthly_usage: {
          spent: monthlySpent,
          api_calls: monthlyApiCalls,
          period: `${startOfMonth.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`
        },
        recent_transactions: recentTransactions.map(tx => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          description: tx.description,
          created_at: tx.createdAt,
          metadata: tx.metadata
        }))
      }
    });
    
    // Prevent any caching
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    
    return response;
  } catch (error) {
    console.error('Error in /api/v1/balance:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}