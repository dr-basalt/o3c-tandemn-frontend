import dbConnect from '../database';
import ChatResponse, { IChatResponse } from '../models/ChatResponse';

export interface CreateChatResponseData {
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
  metadata?: {
    modelVendor?: string;
    modelName?: string;
    requestId?: string;
    error?: string;
  };
}

export interface MetricsQuery {
  userId?: string;
  modelId?: string;
  backendUsed?: 'o3c' | 'openrouter' | 'mock';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface MetricsSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  averageProcessingTime: number;
  requestsByBackend: {
    o3c: number;
    openrouter: number;
    mock: number;
  };
  requestsByModel: Array<{
    modelId: string;
    count: number;
    totalTokens: number;
    totalCost: number;
  }>;
  dailyStats: Array<{
    date: string;
    requests: number;
    tokens: number;
    cost: number;
  }>;
}

export class ChatResponseService {
  static async createChatResponse(data: CreateChatResponseData): Promise<IChatResponse> {
    await dbConnect();
    
    const chatResponse = new ChatResponse({
      ...data,
      timestamp: new Date(),
    });
    
    return await chatResponse.save();
  }

  static async getChatResponses(query: MetricsQuery = {}): Promise<IChatResponse[]> {
    await dbConnect();
    
    const filter: any = {};
    
    if (query.userId) filter.userId = query.userId;
    if (query.modelId) filter.modelId = query.modelId;
    if (query.backendUsed) filter.backendUsed = query.backendUsed;
    if (query.startDate || query.endDate) {
      filter.timestamp = {};
      if (query.startDate) filter.timestamp.$gte = query.startDate;
      if (query.endDate) filter.timestamp.$lte = query.endDate;
    }
    
    const limit = query.limit || 100;
    const offset = query.offset || 0;
    
    return await ChatResponse.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .skip(offset);
  }

  static async getMetricsSummary(query: MetricsQuery = {}): Promise<MetricsSummary> {
    await dbConnect();
    
    const filter: any = {};
    
    if (query.userId) filter.userId = query.userId;
    if (query.modelId) filter.modelId = query.modelId;
    if (query.backendUsed) filter.backendUsed = query.backendUsed;
    if (query.startDate || query.endDate) {
      filter.timestamp = {};
      if (query.startDate) filter.timestamp.$gte = query.startDate;
      if (query.endDate) filter.timestamp.$lte = query.endDate;
    }

    // Get total counts and sums
    const totalStats = await ChatResponse.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$totalCost' },
          averageProcessingTime: { $avg: '$processingTimeMs' },
        },
      },
    ]);

    // Get requests by backend
    const backendStats = await ChatResponse.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$backendUsed',
          count: { $sum: 1 },
        },
      },
    ]);

    // Get requests by model
    const modelStats = await ChatResponse.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$modelId',
          count: { $sum: 1 },
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$totalCost' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Get daily stats for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const dailyStats = await ChatResponse.aggregate([
      { 
        $match: { 
          ...filter, 
          timestamp: { $gte: thirtyDaysAgo } 
        } 
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
          },
          requests: { $sum: 1 },
          tokens: { $sum: '$totalTokens' },
          cost: { $sum: '$totalCost' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const total = totalStats[0] || {
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      averageProcessingTime: 0,
    };

    const requestsByBackend = {
      o3c: 0,
      openrouter: 0,
      mock: 0,
    };

    backendStats.forEach((stat) => {
      requestsByBackend[stat._id as keyof typeof requestsByBackend] = stat.count;
    });

    return {
      totalRequests: total.totalRequests,
      totalTokens: total.totalTokens,
      totalCost: total.totalCost,
      averageProcessingTime: total.averageProcessingTime,
      requestsByBackend,
      requestsByModel: modelStats.map((stat) => ({
        modelId: stat._id,
        count: stat.count,
        totalTokens: stat.totalTokens,
        totalCost: stat.totalCost,
      })),
      dailyStats: dailyStats.map((stat) => ({
        date: stat._id,
        requests: stat.requests,
        tokens: stat.tokens,
        cost: stat.cost,
      })),
    };
  }
}
