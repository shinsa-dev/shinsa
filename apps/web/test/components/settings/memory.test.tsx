import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { MemoryEntry } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemorySettings } from '@/components/settings/memory.tsx';
import type { MemoryActions } from '@/lib/memory.ts';
import { createProject, createShinsaState } from '../../support/state.ts';

function entry(overrides: Partial<MemoryEntry> & { id: string; text: string }): MemoryEntry {
  return {
    projectId: null,
    why: null,
    status: 'kept',
    taskId: null,
    runId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const BASKET = createProject({ id: 'basket', name: 'Basket', color: 'green' });

const PROPOSAL = entry({
  id: 'p1',
  text: 'Keep plans to three phases or fewer.',
  status: 'proposed',
  projectId: 'basket',
  why: 'You asked twice.',
});

const DASHES = entry({ id: 'm1', text: 'Never use em dashes.' });

function createActions() {
  return {
    write: mock(async (_memoryId: string | null, _projectId: string | null, _text: string) => true),
    keep: mock(async (_entry: MemoryEntry) => true),
    remove: mock(async (_entry: MemoryEntry) => true),
  } satisfies MemoryActions;
}

function renderMemory(entries: MemoryEntry[], actions = createActions()) {
  const state = createShinsaState({
    projects: [BASKET],
    patch: { memories: Object.fromEntries(entries.map((item) => [item.id, item])) },
  });
  render(
    <TooltipProvider>
      <MemorySettings state={state} actions={actions} />
    </TooltipProvider>
  );
  return actions;
}

afterEach(() => {
  mock.restore();
});

describe('MemorySettings', () => {
  it('explains what memory is when agents remember nothing', () => {
    renderMemory([]);
    expect(screen.getByText(/Rules every agent follows/)).toBeTruthy();
  });

  it('lists a proposal with where it applies and why, and the kept rules by scope with their count', () => {
    renderMemory([PROPOSAL, DASHES]);
    expect(screen.getByText('Proposed by agents')).toBeTruthy();
    expect(screen.getByText('Basket · You asked twice.')).toBeTruthy();
    expect(screen.getByText('Never use em dashes.')).toBeTruthy();
    expect(screen.getByText('1 of 20')).toBeTruthy();
  });

  it('keeps or dismisses a proposal, and removes a kept rule', () => {
    const actions = renderMemory([PROPOSAL, DASHES]);
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(actions.keep).toHaveBeenCalledWith(PROPOSAL);
    expect(actions.remove.mock.calls.map(([item]) => item.id)).toEqual(['p1', 'm1']);
  });

  it('edits a proposal and keeps it with your words', async () => {
    const actions = renderMemory([PROPOSAL]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit, then keep' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'The rule' }), {
      target: { value: 'Keep plans to two phases.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await waitFor(() =>
      expect(actions.write).toHaveBeenCalledWith('p1', 'basket', 'Keep plans to two phases.')
    );
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'The rule' })).toBeNull());
  });

  it('writes a new rule for every project, and refuses an empty one', async () => {
    const actions = renderMemory([DASHES]);
    fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'The rule' }), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'The rule' }));
    expect(await screen.findByText('Write the rule for agents to follow.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'The rule' }), {
      target: { value: 'Keep it short.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(actions.write).toHaveBeenCalledWith(null, null, 'Keep it short.'));
  });

  it('cancels a form with Escape or Cancel', () => {
    renderMemory([DASHES]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'The rule' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'The rule' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'The rule' })).toBeNull();
  });
});
