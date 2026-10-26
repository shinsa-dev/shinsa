import * as React from 'react';
import { isMacPlatform } from '@/lib/code/keys.ts';
import { resolveTerminalPageKey, type TerminalPageKey } from '@/lib/terminal/keys.ts';

export function useTerminalKeys(actions: Record<TerminalPageKey, () => void>) {
  const latest = React.useRef(actions);
  latest.current = actions;
  React.useEffect(() => {
    const mac = isMacPlatform(navigator.platform);
    const onKeyDown = (event: KeyboardEvent) => {
      const key = resolveTerminalPageKey(event, mac);
      if (!key) return;
      event.preventDefault();
      latest.current[key]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
