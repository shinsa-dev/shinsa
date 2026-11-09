import { describe, expect, it } from 'bun:test';
import type { ShinsaState, Task } from '@shinsa/core';
import { DropdownMenu, DropdownMenuContent } from '@shinsa/ui/components/dropdown-menu';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { InitiativeItems } from '@/components/initiatives/task-items.tsx';
import { spyOnEngine } from '../../support/engine.ts';
import { createInitiative, createShinsaState, createTask } from '../../support/state.ts';

const DOCK = createTask({ id: 'dock', title: 'Rewrite the dock', initiativeId: 'split' });

const LEAD = createTask({
  id: 'lead',
  title: 'Lead the chat split',
  pipeline: ['lead'],
  stage: 'leading',
  initiativeId: 'split',
});

function renderItems(state: ShinsaState, task: Task) {
  render(
    <TooltipProvider>
      <DropdownMenu open>
        <DropdownMenuContent>
          <InitiativeItems state={state} task={task} />
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}

function menuItems() {
  return screen.queryAllByRole('menuitem').map((item) => item.textContent);
}

describe('the initiative items', () => {
  it('give a member the usual items and no edit', () => {
    spyOnEngine();
    const state = createShinsaState({
      initiatives: [createInitiative({ id: 'split', name: 'Chat split', leadTaskId: 'lead' })],
      tasks: [DOCK, LEAD],
    });
    renderItems(state, DOCK);
    expect(menuItems()).toContain('Take out of the initiative');
    expect(menuItems()).not.toContain('Edit the initiative');
  });

  it('give the lead only Edit the initiative', () => {
    spyOnEngine();
    const state = createShinsaState({
      initiatives: [createInitiative({ id: 'split', name: 'Chat split', leadTaskId: 'lead' })],
      tasks: [DOCK, LEAD],
    });
    renderItems(state, LEAD);
    expect(menuItems()).toEqual(['Edit the initiative']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit the initiative' }));
  });
});
