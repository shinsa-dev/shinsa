import * as React from 'react';
import { type CodeKey, isMacPlatform, resolveCodeKey } from '@/lib/code/keys.ts';

export function useCodeKeys(actions: Record<CodeKey, () => void>) {
  const latest = React.useRef(actions);
  latest.current = actions;
  React.useEffect(() => {
    const mac = isMacPlatform(navigator.platform);
    const onKeyDown = (event: KeyboardEvent) => {
      const key = resolveCodeKey(event, mac);
      if (!key) return;
      event.preventDefault();
      latest.current[key]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export function useCodeKeyLabel() {
  return React.useMemo(() => isMacPlatform(navigator.platform), []);
}
