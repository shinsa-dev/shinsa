import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { TaskSuggestion } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SuggestionsPanel } from '@/components/overview/suggestions-panel.tsx';
import { listSentCommands, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createTask } from '../../support/state.ts';

function suggestion(id: string, waitsOnThis: boolean): TaskSuggestion {
  return {
    id,
    runId: null,
    title: `Follow-up ${id}`,
    request: 'Do it.',
    why: 'It helps.',
    waitsOnThis,
    status: 'open',
    createdTaskId: null,
    suggestedAt: 1,
  };
}

function rowOf(title: string) {
  return screen.getByText(title).closest('li') as HTMLElement;
}

async function choose(row: HTMLElement, option: string) {
  const box = within(row).getByRole('combobox', { name: 'When to start' });
  fireEvent.click(box);
  const list = (await screen.findAllByRole('listbox')).at(-1) as HTMLElement;
  const item = within(list).getByRole('option', { name: new RegExp(`^${option}`) });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
  await waitFor(() => expect(box.textContent).toBe(option));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

describe('suggested follow-ups', () => {
  it('starts each on the agent’s suggestion and adds it to start when you chose', async () => {
    const task = createTask({ id: 't', suggestions: [suggestion('a', true), suggestion('b', false)] });
    render(
      <TooltipProvider>
        <SuggestionsPanel task={task} />
      </TooltipProvider>
    );
    const waits = rowOf('Follow-up a');
    const now = rowOf('Follow-up b');
    expect(within(waits).getByRole('combobox', { name: 'When to start' }).textContent).toBe(
      'After this task merges'
    );
    expect(within(now).getByRole('combobox', { name: 'When to start' }).textContent).toBe('Start now');
    await choose(waits, 'Start now');
    await choose(now, 'After this task merges');
    fireEvent.click(within(waits).getByRole('button', { name: 'Add' }));
    const add = within(now).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    await waitFor(() => expect(add.disabled).toBe(false));
    fireEvent.click(add);
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'suggestion.accept', taskId: 't', suggestionId: 'a', waitsOnThis: false },
        { type: 'suggestion.accept', taskId: 't', suggestionId: 'b', waitsOnThis: true },
      ])
    );
  });

  it('marks the agent’s choice as suggested and lists it first', async () => {
    const task = createTask({ id: 't', suggestions: [suggestion('a', true)] });
    render(
      <TooltipProvider>
        <SuggestionsPanel task={task} />
      </TooltipProvider>
    );
    fireEvent.click(within(rowOf('Follow-up a')).getByRole('combobox', { name: 'When to start' }));
    const list = (await screen.findAllByRole('listbox')).at(-1) as HTMLElement;
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['After this task mergesSuggested', 'Start now']);
  });
});

describe('a separate-task suggestion', () => {
  it('can be made a task of its own or kept in this task as the next round', async () => {
    const task = createTask({ id: 't', suggestions: [{ ...suggestion('s1', false), splitOff: true }] });
    render(
      <TooltipProvider>
        <SuggestionsPanel task={task} />
      </TooltipProvider>
    );
    const row = rowOf('Follow-up s1');
    expect(within(row).getByRole('button', { name: 'Make it a task' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Dismiss' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Keep it here' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'suggestion.keep', taskId: 't', suggestionId: 's1' }])
    );
  });
});
