import { afterEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppFrame } from '@/components/layout/frame.tsx';
import { PHONE_QUERY } from '@/components/layout/sidebar/compact-bar.tsx';
import { navigate } from '@/router.ts';
import { createShinsaState } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

const realMatchMedia = globalThis.matchMedia;

afterEach(() => {
  globalThis.matchMedia = realMatchMedia;
});

function emulatePhone() {
  globalThis.matchMedia = ((query: string) => ({
    matches: query === PHONE_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof matchMedia;
}

describe('the More sheet', () => {
  for (const layout of ['cards', 'sidebar'] as const) {
    it(`opens from the ${layout} phone bar and closes when you go to another page`, async () => {
      emulatePhone();
      act(() => navigate('/tasks'));
      render(
        <TooltipProvider>
          <AppFrame layout={layout} state={createShinsaState({})}>
            <p>Page</p>
          </AppFrame>
        </TooltipProvider>
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => fireEvent.click(screen.getByRole('button', { name: 'More' })));
      const sheet = await screen.findByRole('dialog');
      expect(sheet.textContent).toContain('Settings');
      act(() => navigate('/settings'));
      await waitForGone(() => screen.queryByRole('dialog'));
    });
  }
});
