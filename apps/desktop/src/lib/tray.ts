import type { ServerHealth } from './health.ts';

export type TrayItem =
  | { kind: 'status'; label: string }
  | { kind: 'separator' }
  | { kind: 'action'; action: TrayAction; label: string; sublabel?: string };

export type TrayAction = 'open' | 'quit';

export const TRAY_LABEL = {
  open: 'Open Shinsa',
  quit: 'Quit Shinsa',
  quitHint: 'The engine and your agents keep running',
} as const;

export function describeTrayStatus(health: ServerHealth | null) {
  if (!health) return 'The engine is not answering';
  if (health.working === 0) return 'The engine is running. No agents are working';
  if (health.working === 1) return 'The engine is running. 1 agent is working';
  return `The engine is running. ${health.working} agents are working`;
}

export function listTrayItems(health: ServerHealth | null): TrayItem[] {
  return [
    { kind: 'status', label: describeTrayStatus(health) },
    { kind: 'separator' },
    { kind: 'action', action: 'open', label: TRAY_LABEL.open },
    { kind: 'separator' },
    { kind: 'action', action: 'quit', label: TRAY_LABEL.quit, sublabel: TRAY_LABEL.quitHint },
  ];
}
