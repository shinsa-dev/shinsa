import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createSettings, type Settings } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { LimitSettings } from '@/components/settings/usage.tsx';
import { spyOnToasts } from '../../support/commands.ts';
import { listSentCommands, startFakeServer, stopFakeServer } from '../../support/server.ts';

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
  startFakeServer();
});

afterEach(() => {
  toasts.restore();
  stopFakeServer();
});

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('the Limits settings', () => {
  function renderLimits(settings: Settings = createSettings()) {
    return render(
      <TooltipProvider>
        <LimitSettings settings={settings} />
      </TooltipProvider>
    );
  }

  async function choose(label: string, option: string) {
    fireEvent.click(screen.getByRole('combobox', { name: label }));
    await settle();
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    const item = within(list).getByRole('option', { name: option });
    fireEvent.pointerDown(item, { pointerType: 'mouse' });
    fireEvent.click(item);
    await settle();
  }

  it('shows each limit on its current value', () => {
    renderLimits({ ...createSettings(), autoResume: false, snoozeLimited: false });
    expect(screen.getByRole('combobox', { name: 'Switch accounts at' }).textContent).toBe('90%');
    expect(screen.getByRole('combobox', { name: 'After a usage limit' }).textContent).toBe('Wait for me');
    expect(screen.getByRole('combobox', { name: 'Ask me what to do' }).textContent).toBe('Right away');
  });

  it('limits each task to a share of the weekly limit, off by default', async () => {
    renderLimits();
    expect(screen.getByRole('combobox', { name: 'Usage limit per task' }).textContent).toBe('No limit');
    await choose('Usage limit per task', '10% of the weekly limit');
    expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { taskUsageLimit: 10 } }]);
  });

  it('shows the cost limit while one is set', async () => {
    renderLimits({ ...createSettings(), taskBudgetUsd: 5 });
    expect(screen.getByRole('combobox', { name: 'Cost limit per task' }).textContent).toBe('$5.00 per task');
    await choose('Cost limit per task', 'No limit');
    expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { taskBudgetUsd: null } }]);
  });

  it('hides Ask me what to do while runs resume on their own after a usage limit', () => {
    renderLimits();
    expect(screen.queryByRole('combobox', { name: 'Ask me what to do' })).toBeNull();
  });

  it('changes each limit as a settings patch', async () => {
    renderLimits({ ...createSettings(), autoResume: false });
    await choose('Switch accounts at', '95%');
    await choose('After a usage limit', 'Wait for me');
    await choose('Ask me what to do', 'Right away');
    expect(listSentCommands()).toEqual([
      { type: 'settings.change', patch: { accountSwitchAt: 95 } },
      { type: 'settings.change', patch: { autoResume: false } },
      { type: 'settings.change', patch: { snoozeLimited: false } },
    ]);
  });

  it('saves the percentage typed in Other… as the switch threshold', async () => {
    renderLimits();
    await choose('Switch accounts at', 'Other…');
    const field = screen.getByRole('textbox', { name: 'Percentage' });
    fireEvent.change(field, { target: { value: '85' } });
    await act(async () => {
      fireEvent.submit(field.closest('form') as HTMLFormElement);
    });
    await settle();
    expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { accountSwitchAt: 85 } }]);
    expect(screen.queryByRole('textbox', { name: 'Percentage' })).toBeNull();
  });

  it('sends nothing when the custom entry is cancelled', async () => {
    renderLimits();
    await choose('Switch accounts at', 'Other…');
    expect(screen.getByRole('textbox', { name: 'Percentage' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.queryByRole('textbox', { name: 'Percentage' })).toBeNull();
    expect(listSentCommands()).toEqual([]);
  });
});
