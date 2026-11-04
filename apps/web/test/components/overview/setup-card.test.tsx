import { describe, expect, it, mock } from 'bun:test';
import type { Gate } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SetupCard } from '@/components/overview/setup-card.tsx';
import type { GateReplier } from '@/lib/tasks/gates.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

function renderCard(gate: Gate) {
  const task = createTask({ id: 't-setup' });
  const state = createShinsaState({ tasks: [task], gates: [gate] });
  const onReply = mock<GateReplier>(() => Promise.resolve(true));
  render(
    <TooltipProvider>
      <SetupCard state={state} task={task} gate={gate} onReply={onReply} />
    </TooltipProvider>
  );
  return onReply;
}

describe('the setup card', () => {
  it('lists the repositories to pick from and sends the one you click', async () => {
    const onReply = renderCard(
      createGate({
        id: 'g-setup',
        taskId: 't-setup',
        type: 'configuration',
        title: 'Which repository is this task for?',
        choices: ['buzzkit', 'paywall-next'],
      })
    );
    expect(screen.queryByRole('button', { name: 'Verify again' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'paywall-next' }));
    });
    expect(onReply.mock.calls).toEqual([['pickRepository', 'paywall-next']]);
  });

  it('offers to verify again when the setup has no repositories to pick', async () => {
    const onReply = renderCard(
      createGate({
        id: 'g-setup',
        taskId: 't-setup',
        type: 'configuration',
        title: 'The default branch is missing',
      })
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verify again' }));
    });
    expect(onReply.mock.calls).toEqual([['recheck', undefined]]);
  });
});
