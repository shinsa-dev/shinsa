import { Toaster } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/app.tsx';
import { applyLayoutParam } from '@/lib/preferences/layout.ts';
import { applyStoredTheme } from '@/lib/preferences/theme.ts';
import { connection } from '@/lib/state/connection.ts';
import './app.css';

applyStoredTheme();
applyLayoutParam();
if (location.pathname !== '/ui') connection.start();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider>
        <App />
        <Toaster />
      </TooltipProvider>
    </StrictMode>
  );
}
