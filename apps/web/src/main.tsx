import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyLayoutParam } from '@/lib/preferences/layout.ts';
import { followSystemTheme } from '@/lib/preferences/theme.ts';
import { Root } from '@/root.tsx';
import './app.css';

followSystemTheme();
applyLayoutParam();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>
  );
}
