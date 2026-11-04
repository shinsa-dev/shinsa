import { afterEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppFrame } from '@/components/layout/frame.tsx';
import { COMPACT_BAR_QUERY, PHONE_QUERY } from '@/components/layout/sidebar/compact-bar.tsx';
import { navigate } from '@/router.ts';
import { createShinsaState } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

const realMatchMedia = globalThis.matchMedia;

afterEach(() => {
  globalThis.matchMedia = realMatchMedia;
});

function emulateWidth(queries: string[]) {
  globalThis.matchMedia = ((query: string) => ({
    matches: queries.includes(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof matchMedia;
}

function emulatePhone() {
  emulateWidth([PHONE_QUERY, COMPACT_BAR_QUERY]);
}

function renderFrame(layout: 'cards' | 'sidebar') {
  return render(
    <TooltipProvider>
      <AppFrame layout={layout} state={createShinsaState({})}>
        <p>Page</p>
      </AppFrame>
    </TooltipProvider>
  );
}

describe('the More sheet', () => {
  for (const layout of ['cards', 'sidebar'] as const) {
    it(`opens from the ${layout} phone bar and closes when you go to another page`, async () => {
      emulatePhone();
      act(() => navigate('/tasks'));
      renderFrame(layout);
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => fireEvent.click(screen.getByRole('button', { name: 'More' })));
      const sheet = await screen.findByRole('dialog');
      expect(sheet.textContent).toContain('Settings');
      act(() => navigate('/settings'));
      await waitForGone(() => screen.queryByRole('dialog'));
    });
  }
});

describe('the Desk top bar', () => {
  it('folds into the compact bar below md, where the full bar no longer fits', () => {
    emulateWidth([COMPACT_BAR_QUERY]);
    act(() => navigate('/tasks'));
    renderFrame('cards');
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('keeps the full bar from md up', () => {
    emulateWidth([]);
    act(() => navigate('/tasks'));
    renderFrame('cards');
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });
});
