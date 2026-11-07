import type { ServiceSuggestion } from '@shinsa/core';
import * as React from 'react';
import { resolveSuggestionPicks } from '@/lib/terminal/services.ts';

export function usePicks(suggestions: ServiceSuggestion[] | null) {
  const [state, setState] = React.useState<{ seen: ServiceSuggestion[] | null; picked: string[] }>({
    seen: null,
    picked: [],
  });
  const current =
    suggestions === state.seen
      ? state
      : {
          seen: suggestions,
          picked: suggestions ? resolveSuggestionPicks(state.seen, state.picked, suggestions) : state.picked,
        };
  if (current !== state) setState(current);
  const replacePicked = (picked: string[]) => setState((was) => ({ ...was, picked }));
  return [current.picked, replacePicked] as const;
}
