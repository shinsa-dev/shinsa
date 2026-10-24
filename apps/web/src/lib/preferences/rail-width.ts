import { usePaneWidth } from '@/lib/preferences/pane-width.ts';

const RAIL_WIDTH = { min: 200, max: 420, initial: 240 } as const;

export function useRailWidth() {
  return usePaneWidth('shinsa.rail-width', RAIL_WIDTH);
}
