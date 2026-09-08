'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Cell } from 'recharts';
import { Calendar, TrendingUp, DollarSign, MessageSquare, Clock, History, ArrowUpRight, ArrowDownLeft, Zap, Activity, Download } from 'lucide-react';
import { type Transaction } from '@/lib/credits-client';

interface MetricsData {
  summary: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    averageProcessingTime: number;
    // Backend information hidden from user metrics
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
  };
  recentResponses: Array<{
    _id: string;
    userId: string;
    modelId: string;
    inputText: string;
    responseText: string;
    // backendUsed: string; // Hidden from user view
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputCost: number;
    outputCost: number;
    totalCost: number;
    processingTimeMs: number;
    timestamp: string;
  }>;
}

// Color constants removed - no longer needed

export default function MetricsPage() {
  const { user, isSignedIn } = useUser();
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [litellmSpend, setLitellmSpend] = useState<number | null>(null);
  const [filters, setFilters] = useState({
    modelId: '',
    // backendUsed: '', // Hidden from user
    startDate: '',
    endDate: '',
  });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);

  const fetchMetrics = async (isInitialLoad = false) => {
    try {
      if (isInitialLoad) {
        setLoading(true);
      } else {
        setIsFiltering(true);
      }
      setError(null);
      
      const params = new URLSearchParams();
      if (debouncedFilters.modelId) params.append('modelId', debouncedFilters.modelId);
      // Backend filter removed from user interface
      if (debouncedFilters.startDate) params.append('startDate', debouncedFilters.startDate);
      if (debouncedFilters.endDate) params.append('endDate', debouncedFilters.endDate);

      const response = await fetch(`/api/metrics?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch metrics');
      }
      
      const data = await response.json();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      if (isInitialLoad) {
        setLoading(false);
      } else {
        setIsFiltering(false);
      }
    }
  };

  const fetchTransactions = async () => {
    try {
      setTransactionsLoading(true);
      const response = await fetch('/api/credits/transactions');
      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions || []);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setTransactionsLoading(false);
    }
  };

  const fetchAvailableModels = async () => {
    try {
      const response = await fetch('/api/metrics/models');
      if (response.ok) {
        const data = await response.json();
        setAvailableModels(data.models || []);
      }
    } catch (error) {
      console.error('Error fetching available models:', error);
    }
  };

  const fetchLitellmSpend = async () => {
    try {
      const response = await fetch('/api/v1/usage');
      if (response.ok) {
        const data = await response.json();
        if (data.litellm?.spend != null) setLitellmSpend(data.litellm.spend);
      }
    } catch {
      // non-blocking
    }
  };

  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams({ format: 'csv' });
      if (filters.startDate) params.set('start_date', filters.startDate);
      if (filters.endDate) params.set('end_date', filters.endDate);
      const response = await fetch(`/api/v1/usage?${params}`);
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `o3c-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  // Debounce filters to prevent excessive API calls
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [filters]);

  // Initial fetch when signed in
  useEffect(() => {
    if (isSignedIn) {
      fetchMetrics(true); // Initial load
      fetchTransactions();
      fetchAvailableModels();
      fetchLitellmSpend();
    }
  }, [isSignedIn]);

  // Fetch metrics when debounced filters change (but not on initial load)
  useEffect(() => {
    if (isSignedIn && metrics !== null) {
      fetchMetrics(false); // Filter update, not initial load
    }
  }, [debouncedFilters]);

  if (!isSignedIn) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Metrics Dashboard</h1>
          <p className="text-muted-foreground">Please sign in to view metrics.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Metrics Dashboard</h1>
          <p className="text-muted-foreground">Loading metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Metrics Dashboard</h1>
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={() => fetchMetrics(true)}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Metrics Dashboard</h1>
          <p className="text-muted-foreground">No metrics data available.</p>
        </div>
      </div>
    );
  }

  // Backend data removed from user view

  // Transaction helper functions
  const getTransactionIcon = (transaction: Transaction) => {
    switch (transaction.type) {
      case 'credit_purchase':
        return <ArrowDownLeft className="h-4 w-4 text-green-500" />;
      case 'usage_charge':
        return <ArrowUpRight className="h-4 w-4 text-red-500" />;
      case 'bonus_credit':
        return <Zap className="h-4 w-4 text-blue-500" />;
      default:
        return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };

  const formatTransactionDescription = (transaction: Transaction) => {
    if (transaction.metadata?.modelId) {
      const { modelId, inputTokens, outputTokens } = transaction.metadata;
      return `${modelId} (${inputTokens || 0} input, ${outputTokens || 0} output tokens)`;
    }
    return transaction.description;
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold">Metrics Dashboard</h1>
          {isFiltering && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <div className="animate-spin h-3 w-3 border border-gray-300 border-t-gray-600 rounded-full"></div>
              Updating...
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleExportCSV} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
          <Button onClick={() => fetchMetrics(true)} variant="outline">
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Model</label>
              <Select
                value={filters.modelId}
                onValueChange={(value) => setFilters({ ...filters, modelId: value === 'all' ? '' : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All models" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All models</SelectItem>
                  {availableModels.map((modelId) => (
                    <SelectItem key={modelId} value={modelId}>
                      {modelId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Backend filter removed from user interface */}
            <div>
              <label className="text-sm font-medium">Start Date</label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">End Date</label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.summary.totalRequests.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.summary.totalTokens.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${metrics.summary.totalCost.toFixed(4)}</div>
          </CardContent>
        </Card>

        {litellmSpend != null && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">LiteLLM Spend</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${litellmSpend.toFixed(4)}</div>
              <p className="text-xs text-muted-foreground">tracked by gateway</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Charts - Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Daily Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Daily Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={metrics.summary.dailyStats}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="requests" stroke="#8884d8" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Models Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Top Models by Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={metrics.summary.requestsByModel.map((item, index) => ({
                ...item,
                shortName: item.modelId.split('/')[1] || item.modelId,
                color: ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658'][index % 7]
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="shortName" 
                  tick={false}
                  height={20}
                />
                <YAxis />
                <Tooltip 
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-gray-900/90 backdrop-blur-md border border-gray-700/50 rounded-lg p-2 shadow-xl">
                          <div className="space-y-1">
                            <p className="font-medium text-xs text-white">{data.modelId}</p>
                            <div className="flex items-center gap-1">
                              <div 
                                className="w-2 h-2 rounded" 
                                style={{ backgroundColor: data.color }}
                              />
                              <span className="text-xs text-gray-300">Requests: <span className="font-medium text-white">{data.count}</span></span>
                            </div>
                            <div className="text-xs text-gray-400 space-y-0">
                              <p>Tokens: {data.totalTokens?.toLocaleString() || 0}</p>
                              <p>Cost: ${data.totalCost?.toFixed(4) || '0.0000'}</p>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="count">
                  {metrics.summary.requestsByModel.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658'][index % 7]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Model Breakdown List */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Model Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {metrics.summary.requestsByModel.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium">Model</th>
                      <th className="text-right py-2 font-medium">Requests</th>
                      <th className="text-right py-2 font-medium">Total Tokens</th>
                      <th className="text-right py-2 font-medium">Total Cost</th>
                      <th className="text-right py-2 font-medium">Avg Cost/Request</th>
                      <th className="text-right py-2 font-medium">Usage %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.summary.requestsByModel.map((model, index) => {
                      const usagePercentage = metrics.summary.totalRequests > 0 
                        ? ((model.count / metrics.summary.totalRequests) * 100).toFixed(1)
                        : '0.0';
                      const avgCostPerRequest = model.count > 0 
                        ? (model.totalCost / model.count).toFixed(4)
                        : '0.0000';
                      
                      return (
                        <tr key={model.modelId} className="border-b hover:bg-muted/50">
                          <td className="py-3">
                            <div className="flex items-center space-x-2">
                              <Badge variant="outline" className="text-xs">
                                {model.modelId.split('/')[0]}
                              </Badge>
                              <span className="font-medium">{model.modelId}</span>
                            </div>
                          </td>
                          <td className="text-right py-3 font-mono">
                            {model.count.toLocaleString()}
                          </td>
                          <td className="text-right py-3 font-mono">
                            {model.totalTokens.toLocaleString()}
                          </td>
                          <td className="text-right py-3 font-mono">
                            ${model.totalCost.toFixed(4)}
                          </td>
                          <td className="text-right py-3 font-mono">
                            ${avgCostPerRequest}
                          </td>
                          <td className="text-right py-3">
                            <div className="flex items-center justify-end space-x-2">
                              <div className="w-16 bg-muted rounded-full h-2">
                                <div 
                                  className="bg-primary h-2 rounded-full" 
                                  style={{ width: `${usagePercentage}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-8">
                                {usagePercentage}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-medium">
                      <td className="py-3">Total</td>
                      <td className="text-right py-3 font-mono">
                        {metrics.summary.totalRequests.toLocaleString()}
                      </td>
                      <td className="text-right py-3 font-mono">
                        {metrics.summary.totalTokens.toLocaleString()}
                      </td>
                      <td className="text-right py-3 font-mono">
                        ${metrics.summary.totalCost.toFixed(4)}
                      </td>
                      <td className="text-right py-3 font-mono">
                        ${metrics.summary.totalRequests > 0 
                          ? (metrics.summary.totalCost / metrics.summary.totalRequests).toFixed(4)
                          : '0.0000'
                        }
                      </td>
                      <td className="text-right py-3">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No model usage data available yet.</p>
                <p className="text-sm">Start chatting to see model breakdown statistics.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Responses */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Responses</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {metrics.recentResponses.map((response) => (
              <div key={response._id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline">{response.modelId}</Badge>
                    {/* Backend badge removed from user view */}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(response.timestamp).toLocaleString()}
                  </div>
                </div>
                <div className="text-sm mb-2">
                  <strong>Input:</strong> {response.inputText.substring(0, 100)}...
                </div>
                <div className="text-sm mb-2">
                  <strong>Response:</strong> {response.responseText.substring(0, 100)}...
                </div>
                <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                  <span>Tokens: {response.totalTokens}</span>
                  <span>Cost: ${response.totalCost.toFixed(4)}</span>
                  <span>Time: {response.processingTimeMs}ms</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card className="mt-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Transaction History
              </CardTitle>
              <CardDescription>
                Detailed record of all API usage and credit purchases
              </CardDescription>
            </div>
            <Badge variant="outline">{transactions.length} total</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {transactionsLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="h-8 w-8 bg-muted animate-pulse rounded-full"></div>
                    <div className="space-y-2">
                      <div className="h-4 w-48 bg-muted animate-pulse rounded"></div>
                      <div className="h-3 w-32 bg-muted animate-pulse rounded"></div>
                    </div>
                  </div>
                  <div className="h-6 w-16 bg-muted animate-pulse rounded"></div>
                </div>
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-12">
              <History className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-2">No transactions yet</p>
              <p className="text-sm text-muted-foreground">
                Start using the API to see your transaction history
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {transactions.slice(0, 50).map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0">
                      {getTransactionIcon(transaction)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">
                        {formatTransactionDescription(transaction)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(transaction.createdAt).toLocaleString()}
                      </p>
                      {transaction.metadata?.cost && (
                        <p className="text-xs text-muted-foreground">
                          Cost: ${transaction.metadata.cost.toFixed(4)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-semibold text-sm ${
                      transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {transaction.amount > 0 ? '+' : ''}${Math.abs(transaction.amount).toFixed(4)}
                    </p>
                    <Badge 
                      variant={transaction.status === 'completed' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {transaction.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
