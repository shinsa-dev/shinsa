import { describe, expect, it } from 'bun:test';
import type { ServiceSuggestion } from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import { usePicks } from '@/components/services/use-picks.ts';
import { resolveSuggestionKey } from '@/lib/terminal/services.ts';

const DETECTED = { previewUrl: null, portVariable: 'PORT' };

function createSuggestion(name: string, command = 'bun run dev'): ServiceSuggestion {
  return { name, cwd: `/shop/apps/${name}`, command, source: 'package', recommended: true, ...DETECTED };
}

const FOUND = [createSuggestion('api'), createSuggestion('web')];

const CHECKED = FOUND.map((each) => ({ ...each, command: `${each.command} --port $PORT` }));

function renderPicks(initial: ServiceSuggestion[] | null) {
  const rendered: { suggestions: ServiceSuggestion[] | null; picked: string[] }[] = [];
  const hook = renderHook(
    ({ suggestions }) => {
      const [picked, setPicked] = usePicks(suggestions);
      rendered.push({ suggestions, picked });
      return { picked, setPicked };
    },
    { initialProps: { suggestions: initial } }
  );
  return { ...hook, rendered };
}

describe('usePicks', () => {
  it('starts from the recommended ticks, and from none while nothing was found', () => {
    expect(renderPicks(null).result.current.picked).toEqual([]);
    expect(renderPicks(FOUND).result.current.picked).toEqual(FOUND.map(resolveSuggestionKey));
  });

  it('carries the ticks you changed to the checked list in the same render it arrives', () => {
    const { result, rerender, rendered } = renderPicks(FOUND);
    act(() => result.current.setPicked([resolveSuggestionKey(createSuggestion('web'))]));
    rendered.length = 0;
    rerender({ suggestions: CHECKED });
    expect(result.current.picked).toEqual([resolveSuggestionKey(CHECKED[1] as ServiceSuggestion)]);
    expect(rendered.every((each) => each.suggestions === CHECKED)).toBe(true);
    expect(
      rendered.every((each) => each.picked.every((key) => CHECKED.map(resolveSuggestionKey).includes(key)))
    ).toBe(true);
  });

  it('keeps the ticks while the list is gone, then starts a new list from its recommended ones', () => {
    const { result, rerender } = renderPicks(FOUND);
    act(() => result.current.setPicked([]));
    rerender({ suggestions: null });
    expect(result.current.picked).toEqual([]);
    const other = [createSuggestion('docs')];
    rerender({ suggestions: other });
    expect(result.current.picked).toEqual([resolveSuggestionKey(other[0] as ServiceSuggestion)]);
  });
});
