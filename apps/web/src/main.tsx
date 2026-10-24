import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyDesktop } from '@/lib/desktop.ts';
import { applyLayoutParam } from '@/lib/preferences/layout.ts';
import { followSystemTheme } from '@/lib/preferences/theme.ts';
import { Root } from '@/root.tsx';
import { navigate } from '@/router.ts';
import './app.css';

followSystemTheme();
applyLayoutParam();
applyDesktop(navigate);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>
  );
}
