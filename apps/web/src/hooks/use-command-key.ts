import * as React from 'react';
import { toggleCommandMenu } from '@/lib/command/registry.ts';

export function useCommandHotkey() {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      toggleCommandMenu();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export function useCommandKey() {
  return React.useMemo(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘' : 'Ctrl'), []);
}
