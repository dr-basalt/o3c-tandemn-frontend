'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Zap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FallbackNotificationProps {
  backend: 'o3c' | 'openrouter' | 'mock';
  onDismiss?: () => void;
}

export function FallbackNotification({ backend, onDismiss }: FallbackNotificationProps) {
  const [isVisible, setIsVisible] = useState(false);

  // Only show fallback notification in development mode
  const isDevelopment = process.env.NODE_ENV === 'development';

  useEffect(() => {
    // Only show notification in development mode for fallback services
    if (isDevelopment && (backend === 'openrouter' || backend === 'mock')) {
      setIsVisible(true);
      // Auto-hide after 15 seconds
      const timer = setTimeout(() => {
        setIsVisible(false);
        onDismiss?.();
      }, 15000);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [backend, onDismiss, isDevelopment]);
  
  // Don't render if backend is o3c (primary system) or if notification should be hidden
  if (backend === 'o3c' || !isDevelopment || !isVisible || (backend !== 'openrouter' && backend !== 'mock')) {
    return null;
  }

  const getFallbackMessage = () => {
    if (backend === 'openrouter') {
      return 'Using OpenRouter API for this response.';
    } else if (backend === 'mock') {
      return 'Using mock response (all backends unavailable).';
    }
    return 'Using fallback response.';
  };

  return (
    <Card className="mb-4 border-orange-300 bg-orange-100 shadow-lg">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-orange-600" />
            <span className="text-orange-900 text-sm font-medium">
              <strong>⚠️ Fallback Mode:</strong> Your o3c backend is unavailable. 
              {getFallbackMessage()}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsVisible(false);
              onDismiss?.();
            }}
            className="text-orange-600 hover:text-orange-800 h-6 w-6 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
