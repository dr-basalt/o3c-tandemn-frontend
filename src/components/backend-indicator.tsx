'use client';

import { Badge } from '@/components/ui/badge';
import { Server, Zap } from 'lucide-react';

interface BackendIndicatorProps {
  backend: 'o3c' | 'openrouter' | 'mock';
  className?: string;
}

export function BackendIndicator({ backend, className = '' }: BackendIndicatorProps) {
  const isFallback = backend === 'openrouter' || backend === 'mock';
  
  return (
    <Badge 
      variant={isFallback ? 'secondary' : 'default'} 
      className={`text-xs ${className}`}
    >
      {backend === 'openrouter' ? (
        <>
          <Zap className="h-3 w-3 mr-1" />
          OpenRouter
        </>
      ) : backend === 'mock' ? (
        <>
          <Zap className="h-3 w-3 mr-1" />
          Mock
        </>
      ) : (
        <>
          <Server className="h-3 w-3 mr-1" />
          O3C
        </>
      )}
    </Badge>
  );
}
