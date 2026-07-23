'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Server, Cpu, HardDrive } from 'lucide-react';

interface MachineMetrics {
  machine_id: string;
  metrics: {
    cpu_percent: number;
    ram_percent: number;
    total_free_vram_gb: number;
    gpu_count: number;
    gpu_info: any[];
  };
  timestamp: string;
}

interface HealthResponse {
  status: string;
  machines: MachineMetrics[];
  timestamp: string;
}

export function O3CHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/o3c/health');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    // Refresh every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-yellow-500';
    }
  };

  if (error) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            O3C Backend Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="text-red-600">Backend Unavailable</div>
            <Button onClick={fetchHealth} disabled={loading} size="sm">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <p className="text-sm text-gray-600 mt-2">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          O3C Backend Status
          <Button onClick={fetchHealth} disabled={loading} size="sm" variant="ghost">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && !health ? (
          <div className="text-center py-4">Loading...</div>
        ) : health ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor(health.status)}`} />
              <span className="font-medium">
                {health.status === 'success' ? 'Connected' : 'Disconnected'}
              </span>
              <Badge variant="outline">
                {health.machines.length} machine{health.machines.length !== 1 ? 's' : ''}
              </Badge>
            </div>

            <div className="grid gap-3">
              {health.machines.map((machine) => (
                <div key={machine.machine_id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm">
                      {machine.machine_id.slice(0, 8)}...
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(machine.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1">
                      <Cpu className="h-3 w-3" />
                      <span>CPU: {machine.metrics.cpu_percent.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      <span>RAM: {machine.metrics.ram_percent.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      <span>VRAM: {machine.metrics.total_free_vram_gb.toFixed(1)}GB</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>GPU: {machine.metrics.gpu_count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
