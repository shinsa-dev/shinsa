import { describe, expect, it } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { useAppEffect } from '@/hooks/use-app-effect.ts';

describe('useAppEffect', () => {
  it('runs the effect while mounted and interrupts it on unmount', async () => {
    const seen: string[] = [];
    const watch = (name: string) =>
      Effect.sync(() => seen.push(`start ${name}`)).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() => Effect.sync(() => seen.push(`stop ${name}`)))
      );
    const { rerender, unmount } = renderHook(({ name }) => useAppEffect(() => watch(name), [name]), {
      initialProps: { name: 'a' },
    });
    await waitFor(() => expect(seen).toEqual(['start a']));
    rerender({ name: 'a' });
    rerender({ name: 'b' });
    await waitFor(() => expect(seen).toEqual(['start a', 'stop a', 'start b']));
    unmount();
    await waitFor(() => expect(seen).toEqual(['start a', 'stop a', 'start b', 'stop b']));
  });
});
