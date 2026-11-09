import { describe, expect, it } from 'bun:test';
import type { ShinsaState, Task } from '@shinsa/core';
import { DropdownMenu, DropdownMenuContent } from '@shinsa/ui/components/dropdown-menu';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InitiativeItems } from '@/components/initiatives/task-items.tsx';
import { spyOnCommands } from '../../support/commands.ts';
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

describe('a member’s initiative items', () => {
  it('start a lead from the member’s chat while the initiative has none', async () => {
    spyOnEngine();
    const spies = spyOnCommands();
    const state = createShinsaState({
      initiatives: [createInitiative({ id: 'split', name: 'Chat split' })],
      tasks: [DOCK],
    });
    renderItems(state, DOCK);
    expect(menuItems()).toContain('Start a lead from this chat');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start a lead from this chat' }));
    await waitFor(() =>
      expect(spies.sent.mock.calls.map((call) => call[0])).toEqual([
        { type: 'initiative.start_lead', initiativeId: 'split', forkOf: 'dock' },
      ])
    );
  });

  it('leave it out once the initiative has a live lead', () => {
    spyOnEngine();
    const state = createShinsaState({
      initiatives: [createInitiative({ id: 'split', name: 'Chat split', leadTaskId: 'lead' })],
      tasks: [DOCK, LEAD],
    });
    renderItems(state, DOCK);
    expect(menuItems()).toContain('Take out of the initiative');
    expect(menuItems()).not.toContain('Start a lead from this chat');
  });
});
