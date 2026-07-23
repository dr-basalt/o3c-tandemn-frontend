import { Model, ChatRoom, Message, ModelsFilter, RankingModel, User, Transaction, Usage, CreditBalance } from './types';
import { generateModels, getFeaturedModels, getKPIStats } from './seed';
import { getModelById as getModelByIdFromConfig } from '@/lib/models-config';
import { getModelById as getO3CModelById, getAllModels as getAllO3CModels } from '@/config/models';

// In-memory database
export class MockDB {
  private static instance: MockDB;
  public models: Model[];
  public rooms: Map<string, ChatRoom[]> = new Map(); // userId -> rooms
  public messages: Map<string, Message[]> = new Map(); // roomId -> messages
  public users: Map<string, User> = new Map(); // userId -> user
  public transactions: Map<string, Transaction[]> = new Map(); // userId -> transactions
  public usage: Map<string, Usage[]> = new Map(); // userId -> usage records
  public creditBalances: Map<string, CreditBalance> = new Map(); // userId -> balance
  
  private constructor() {
    this.models = this.getO3CModels();
    this.initializeDemoData();
  }
  
  private getO3CModels(): Model[] {
    return getAllO3CModels().map(o3cModel => ({
      id: o3cModel.id,
      name: o3cModel.name,
      vendor: o3cModel.provider,
      series: o3cModel.provider.toLowerCase(),
      short: o3cModel.name.toLowerCase().replace(/\s+/g, '-'),
      context: o3cModel.context_length,
      promptPrice: o3cModel.input_price_per_1m,
      completionPrice: o3cModel.output_price_per_1m,
      tokensPerWeek: 100000, // Mock popularity
      latencyMs: 1000, // Default latency
      weeklyGrowthPct: 5.2, // Mock growth
      modalities: ['text'],
      description: o3cModel.description,
      badges: ['O3C', ...(o3cModel.capabilities || [])],
    } as Model));
  }
  
  private initializeDemoData() {
    // Create demo user with some initial data
    const demoUserId = 'demo-user';
    const demoUser: User = {
      id: demoUserId,
      name: 'Demo User',
      email: 'demo@demo.dev',
      credits: 25.50,
    };
    
    this.users.set(demoUserId, demoUser);
    
    // Initialize credit balance
    const balance: CreditBalance = {
      userId: demoUserId,
      balance: 25.50,
      totalEarned: 50.00,
      totalSpent: 24.50,
      lastUpdated: new Date().toISOString(),
    };
    this.creditBalances.set(demoUserId, balance);
    
    // Add some demo transactions
    const transactions: Transaction[] = [
      {
        id: 'txn_1',
        userId: demoUserId,
        type: 'purchase',
        amount: 50.00,
        description: 'Credit purchase via Stripe',
        metadata: { stripePaymentId: 'pi_demo_123' },
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'txn_2',
        userId: demoUserId,
        type: 'usage',
        amount: -2.45,
        description: 'Chat completion with GPT-4',
        modelId: 'openai/gpt-4',
        tokens: 1250,
        metadata: { roomId: 'room_demo_1', messageId: 'msg_demo_1' },
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'txn_3',
        userId: demoUserId,
        type: 'usage',
        amount: -18.75,
        description: 'Image generation with DALL-E 3',
        modelId: 'openai/dall-e-3',
        tokens: 0,
        metadata: { roomId: 'room_demo_2' },
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'txn_4',
        userId: demoUserId,
        type: 'usage',
        amount: -1.85,
        description: 'Chat completion with Claude 3 Sonnet',
        modelId: 'anthropic/claude-3-sonnet',
        tokens: 890,
        metadata: { roomId: 'room_demo_3', messageId: 'msg_demo_2' },
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'txn_5',
        userId: demoUserId,
        type: 'usage',
        amount: -1.45,
        description: 'Chat completion with Gemini Pro',
        modelId: 'google/gemini-pro',
        tokens: 750,
        metadata: { roomId: 'room_demo_4', messageId: 'msg_demo_3' },
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ];
    this.transactions.set(demoUserId, transactions);
    
    // Add some usage records
    const usageRecords: Usage[] = [
      {
        id: 'usage_1',
        userId: demoUserId,
        modelId: 'openai/gpt-4',
        roomId: 'room_demo_1',
        messageId: 'msg_demo_1',
        inputTokens: 450,
        outputTokens: 800,
        totalTokens: 1250,
        cost: 2.45,
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'usage_2',
        userId: demoUserId,
        modelId: 'anthropic/claude-3-sonnet',
        roomId: 'room_demo_3',
        messageId: 'msg_demo_2',
        inputTokens: 340,
        outputTokens: 550,
        totalTokens: 890,
        cost: 1.85,
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: 'usage_3',
        userId: demoUserId,
        modelId: 'google/gemini-pro',
        roomId: 'room_demo_4',
        messageId: 'msg_demo_3',
        inputTokens: 280,
        outputTokens: 470,
        totalTokens: 750,
        cost: 1.45,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ];
    this.usage.set(demoUserId, usageRecords);
  }
  
  static getInstance(): MockDB {
    if (!MockDB.instance) {
      MockDB.instance = new MockDB();
    }
    return MockDB.instance;
  }
  
  // Model queries
  getModels(filter: ModelsFilter = {}): { items: Model[]; total: number; hasMore: boolean } {
    let filtered = [...this.models];
    
    // Apply filters
    if (filter.q) {
      const query = filter.q.toLowerCase();
      filtered = filtered.filter(model => 
        model.name.toLowerCase().includes(query) ||
        model.vendor.toLowerCase().includes(query) ||
        model.description.toLowerCase().includes(query)
      );
    }
    
    if (filter.modalities && filter.modalities.length > 0) {
      filtered = filtered.filter(model =>
        filter.modalities!.some(mod => model.modalities.includes(mod as any))
      );
    }
    
    if (filter.series && filter.series.length > 0) {
      filtered = filtered.filter(model => filter.series!.includes(model.series));
    }
    
    if (filter.contextMin !== undefined) {
      filtered = filtered.filter(model => model.context >= filter.contextMin!);
    }
    
    if (filter.contextMax !== undefined) {
      filtered = filtered.filter(model => model.context <= filter.contextMax!);
    }
    
    if (filter.promptPriceMax !== undefined) {
      filtered = filtered.filter(model => model.promptPrice <= filter.promptPriceMax!);
    }
    
    // Apply sorting
    switch (filter.sort) {
      case 'popularity':
        filtered.sort((a, b) => b.tokensPerWeek - a.tokensPerWeek);
        break;
      case 'latency':
        filtered.sort((a, b) => a.latencyMs - b.latencyMs);
        break;
      case 'priceLow':
        filtered.sort((a, b) => a.promptPrice - b.promptPrice);
        break;
      case 'priceHigh':
        filtered.sort((a, b) => b.promptPrice - a.promptPrice);
        break;
      case 'name':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      default:
        // Keep default popularity order
        break;
    }
    
    // Pagination
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const items = filtered.slice(startIndex, endIndex);
    
    return {
      items,
      total: filtered.length,
      hasMore: endIndex < filtered.length,
    };
  }
  
  getModelById(id: string): Model | undefined {
    // First try our O3C models
    const o3cModel = getO3CModelById(id);
    if (o3cModel) {
      // Convert O3C model to Mock model format
      return {
        id: o3cModel.id,
        name: o3cModel.name,
        vendor: o3cModel.provider,
        series: o3cModel.provider.toLowerCase(),
        short: o3cModel.name.toLowerCase().replace(/\s+/g, '-'),
        context: o3cModel.context_length,
        promptPrice: o3cModel.input_price_per_1m,
        completionPrice: o3cModel.output_price_per_1m,
        tokensPerWeek: 100000, // Mock popularity
        latencyMs: 1000, // Default latency
        weeklyGrowthPct: 5.2, // Mock growth
        modalities: ['text'],
        description: o3cModel.description,
        badges: ['O3C', ...(o3cModel.capabilities || [])],
      } as Model;
    }
    
    // Fallback to old config for backwards compatibility
    return getModelByIdFromConfig(id);
  }
  
  getFeatured() {
    return {
      featured: getFeaturedModels(this.models),
      kpis: getKPIStats(),
    };
  }
  
  getRankings(): RankingModel[] {
    return this.models
      .slice(0, 100)
      .map(model => ({
        id: model.id,
        name: model.name,
        vendor: model.vendor,
        latencyMs: model.latencyMs,
        tokensPerWeek: model.tokensPerWeek,
        weeklyGrowthPct: model.weeklyGrowthPct,
      }));
  }
  
  // Room management
  getUserRooms(userId: string): ChatRoom[] {
    return this.rooms.get(userId) || [];
  }
  
  createRoom(userId: string, room: Omit<ChatRoom, 'id' | 'createdAt'>): ChatRoom {
    const newRoom: ChatRoom = {
      ...room,
      id: `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
      userId,
    };
    
    const userRooms = this.rooms.get(userId) || [];
    userRooms.unshift(newRoom);
    this.rooms.set(userId, userRooms);
    
    return newRoom;
  }
  
  deleteRoom(userId: string, roomId: string): boolean {
    const userRooms = this.rooms.get(userId) || [];
    const index = userRooms.findIndex(room => room.id === roomId);
    
    if (index >= 0) {
      userRooms.splice(index, 1);
      this.rooms.set(userId, userRooms);
      this.messages.delete(roomId);
      return true;
    }
    
    return false;
  }
  
  // Message management
  getRoomMessages(roomId: string): Message[] {
    return this.messages.get(roomId) || [];
  }
  
  addMessage(message: Omit<Message, 'id' | 'createdAt'>): Message {
    const newMessage: Message = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
    };
    
    const roomMessages = this.messages.get(message.roomId) || [];
    roomMessages.push(newMessage);
    this.messages.set(message.roomId, roomMessages);
    
    return newMessage;
  }
  
  // Credit and user management
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }
  
  createUser(user: User): User {
    this.users.set(user.id, user);
    
    // Initialize credit balance
    const balance: CreditBalance = {
      userId: user.id,
      balance: user.credits || 0,
      totalEarned: user.credits || 0,
      totalSpent: 0,
      lastUpdated: new Date().toISOString(),
    };
    this.creditBalances.set(user.id, balance);
    
    return user;
  }
  
  updateUserCredits(userId: string, newBalance: number): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    
    user.credits = newBalance;
    this.users.set(userId, user);
    
    // Update credit balance record
    const balance = this.creditBalances.get(userId);
    if (balance) {
      balance.balance = newBalance;
      balance.lastUpdated = new Date().toISOString();
      this.creditBalances.set(userId, balance);
    }
    
    return true;
  }
  
  getCreditBalance(userId: string): CreditBalance | undefined {
    return this.creditBalances.get(userId);
  }
  
  // Transaction management
  getUserTransactions(userId: string, limit = 50): Transaction[] {
    const transactions = this.transactions.get(userId) || [];
    return transactions.slice(0, limit);
  }
  
  addTransaction(transaction: Omit<Transaction, 'id' | 'createdAt'>): Transaction {
    const newTransaction: Transaction = {
      ...transaction,
      id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
    };
    
    const userTransactions = this.transactions.get(transaction.userId) || [];
    userTransactions.unshift(newTransaction); // Add to beginning for chronological order
    this.transactions.set(transaction.userId, userTransactions);
    
    // Update user credits and balance
    const user = this.users.get(transaction.userId);
    if (user) {
      user.credits += transaction.amount;
      this.users.set(transaction.userId, user);
      
      const balance = this.creditBalances.get(transaction.userId);
      if (balance) {
        balance.balance += transaction.amount;
        if (transaction.amount > 0) {
          balance.totalEarned += transaction.amount;
        } else {
          balance.totalSpent += Math.abs(transaction.amount);
        }
        balance.lastUpdated = new Date().toISOString();
        this.creditBalances.set(transaction.userId, balance);
      }
    }
    
    return newTransaction;
  }
  
  // Usage tracking
  getUserUsage(userId: string, limit = 50): Usage[] {
    const usage = this.usage.get(userId) || [];
    return usage.slice(0, limit);
  }
  
  addUsage(usage: Omit<Usage, 'id' | 'createdAt'>): Usage {
    const newUsage: Usage = {
      ...usage,
      id: `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
    };
    
    const userUsage = this.usage.get(usage.userId) || [];
    userUsage.unshift(newUsage); // Add to beginning for chronological order
    this.usage.set(usage.userId, userUsage);
    
    // Create corresponding transaction
    const model = this.getModelById(usage.modelId);
    this.addTransaction({
      userId: usage.userId,
      type: 'usage',
      amount: -usage.cost,
      description: `${model?.name || 'Model'} usage - ${usage.totalTokens} tokens`,
      modelId: usage.modelId,
      tokens: usage.totalTokens,
      metadata: {
        roomId: usage.roomId,
        messageId: usage.messageId,
      },
    });
    
    return newUsage;
  }
  
  // Analytics
  getUserUsageStats(userId: string, days = 30): {
    totalTokens: number;
    totalCost: number;
    modelBreakdown: Record<string, { tokens: number; cost: number; count: number }>;
  } {
    const usage = this.usage.get(userId) || [];
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const recentUsage = usage.filter(u => new Date(u.createdAt) >= cutoff);
    
    let totalTokens = 0;
    let totalCost = 0;
    const modelBreakdown: Record<string, { tokens: number; cost: number; count: number }> = {};
    
    recentUsage.forEach(u => {
      totalTokens += u.totalTokens;
      totalCost += u.cost;
      
      if (!modelBreakdown[u.modelId]) {
        modelBreakdown[u.modelId] = { tokens: 0, cost: 0, count: 0 };
      }
      modelBreakdown[u.modelId].tokens += u.totalTokens;
      modelBreakdown[u.modelId].cost += u.cost;
      modelBreakdown[u.modelId].count += 1;
    });
    
    return { totalTokens, totalCost, modelBreakdown };
  }
}

export const db = MockDB.getInstance();
