'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/store/ui';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useUIStore(state => state.theme);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('dark', theme === 'dark');
    html.classList.toggle('light', theme === 'light');
  }, [theme]);

  return <>{children}</>;
}
