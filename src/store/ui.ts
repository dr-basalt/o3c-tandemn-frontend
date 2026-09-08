import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  theme: 'light' | 'dark';
  sidebarOpen: boolean;
  commandMenuOpen: boolean;
  modelsView: 'list' | 'grid';
  
  // Actions
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setCommandMenuOpen: (open: boolean) => void;
  toggleCommandMenu: () => void;
  setModelsView: (view: 'list' | 'grid') => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarOpen: true,
      commandMenuOpen: false,
      modelsView: 'list',
      
      setTheme: (theme) => set({ theme }),
      
      toggleTheme: () => set((state) => ({
        theme: state.theme === 'light' ? 'dark' : 'light',
      })),
      
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      
      toggleSidebar: () => set((state) => ({
        sidebarOpen: !state.sidebarOpen,
      })),
      
      setCommandMenuOpen: (open) => set({ commandMenuOpen: open }),
      
      toggleCommandMenu: () => set((state) => ({
        commandMenuOpen: !state.commandMenuOpen,
      })),
      
      setModelsView: (view) => set({ modelsView: view }),
    }),
    {
      name: 'ui-store',
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
        modelsView: state.modelsView,
      }),
    }
  )
);
