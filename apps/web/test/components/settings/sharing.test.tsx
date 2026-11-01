import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createSettings } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SharingSettings } from '@/components/settings/sharing.tsx';
import { spyOnToasts } from '../../support/commands.ts';
import { listSentCommands, startFakeServer, stopFakeServer } from '../../support/server.ts';

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
  startFakeServer();
});

afterEach(async () => {
  await settle();
  toasts.restore();
  stopFakeServer();
});

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  await settle();
  const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
  const item = within(list).getByRole('option', { name: option });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
  await settle();
}

describe('Settings → General → Sharing', () => {
  it('shares everything by default, and saves the preset you pick', async () => {
    render(
      <TooltipProvider>
        <SharingSettings settings={createSettings()} />
      </TooltipProvider>
    );
    expect(screen.getByRole('combobox', { name: 'Share tasks as' }).textContent).toBe('Everything');
    await choose('Share tasks as', /^Status/);
    expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { sharePreset: 'status' } }]);
  });
});
