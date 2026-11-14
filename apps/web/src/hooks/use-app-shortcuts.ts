import * as React from 'react';
import { isMacPlatform } from '@/lib/code/keys.ts';
import { writeCommandMenuOpen } from '@/lib/command/registry.ts';
import { type PendingChord, resolveAppShortcut, resolveShortcutPath } from '@/lib/command/shortcuts.ts';
import { navigate } from '@/router.ts';

export function useAppShortcuts() {
  React.useEffect(() => {
    const mac = isMacPlatform(navigator.platform);
    let pending: PendingChord | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      const result = resolveAppShortcut(event, pending, mac);
      pending = result.kind === 'pending' ? result.chord : null;
      if (result.kind !== 'go') return;
      event.preventDefault();
      writeCommandMenuOpen(false);
      navigate(resolveShortcutPath(result.target));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
