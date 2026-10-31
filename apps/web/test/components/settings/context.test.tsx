import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createSettings, type Settings } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ContextSettings } from '@/components/settings/context.tsx';
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

function renderContext(settings: Settings = createSettings()) {
  return render(
    <TooltipProvider>
      <ContextSettings settings={settings} />
    </TooltipProvider>
  );
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

describe('Settings → General → Context', () => {
  it('folds by default and leaves idle compaction to provider compaction', async () => {
    renderContext();
    expect(screen.getByRole('combobox', { name: 'Context management' }).textContent).toBe('Default');
    expect(screen.queryByRole('combobox', { name: 'Compact idle sessions' })).toBeNull();
    await choose('Context management', /^Compaction only/);
    expect(listSentCommands()).toEqual([{ type: 'settings.change', patch: { compaction: 'compact' } }]);
  });

  it('with provider compaction, idle sessions can be compacted before the cache expires', async () => {
    renderContext({ ...createSettings(), compaction: 'provider' });
    expect(screen.getByRole('combobox', { name: 'Compact idle sessions' }).textContent).toBe('Never');
    await choose('Compact idle sessions', '5 minutes before the cache expires');
    expect(listSentCommands()).toEqual([
      { type: 'settings.change', patch: { idleCompaction: true, compactionLeadMinutes: 5 } },
    ]);
  });
});
