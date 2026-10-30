import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { TaskSuggestion } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render } from '@testing-library/react';
import { UserMessage } from '@/components/chat/user-message.tsx';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const ID = createDisclosureId('task', 't', 'chat', 'block', 'm1', 'message');

function suggestion(overrides: Partial<TaskSuggestion> = {}): TaskSuggestion {
  return {
    id: 's1',
    runId: null,
    title: 'Stage the docs and skills files',
    request: 'Stage the docs and skills files.',
    why: 'It is work in other repositories.',
    waitsOnThis: false,
    status: 'open',
    createdTaskId: null,
    suggestedAt: 1,
    splitOff: true,
    ...overrides,
  };
}

function renderMessage() {
  return render(
    <TooltipProvider>
      <UserMessage
        persistId={ID}
        text='Stage the docs and skills files.'
        status='split_off'
        splitOff={{ taskId: 't', suggestionId: 's1' }}
      />
    </TooltipProvider>
  );
}

describe('a message read as work for another task', () => {
  let spies: ReturnType<typeof spyOnCommands>;

  beforeEach(() => {
    startFakeServer();
    spies = spyOnCommands();
  });

  afterEach(() => {
    spies.restore();
    stopFakeServer();
  });

  it('shows its suggested task as a card under the message, kept here or made a task from the chat', async () => {
    pushState(createShinsaState({ tasks: [createTask({ id: 't', suggestions: [suggestion()] })] }));
    const view = renderMessage();
    expect(view.getByText('Suggested as a separate task')).toBeTruthy();
    expect(view.getByText('Not sent to the agent')).toBeTruthy();
    expect(view.getByText('Stage the docs and skills files')).toBeTruthy();
    expect(view.container.textContent).not.toContain('Overview');
    fireEvent.click(view.getByRole('button', { name: 'Keep it here' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.click(view.getByRole('button', { name: 'Make it a task' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(spies.sent.mock.calls.map(([command]) => command)).toEqual([
      { type: 'suggestion.keep', taskId: 't', suggestionId: 's1' },
      { type: 'suggestion.accept', taskId: 't', suggestionId: 's1', waitsOnThis: false },
    ]);
  });

  it('once made a task, links to that task and offers no buttons', () => {
    const created = createTask({ id: 't2', title: 'Stage the docs and skills files' });
    const parent = createTask({
      id: 't',
      suggestions: [suggestion({ status: 'accepted', createdTaskId: 't2' })],
    });
    pushState(createShinsaState({ tasks: [parent, created] }));
    const view = renderMessage();
    expect(view.getByText('Made into a task')).toBeTruthy();
    expect(view.container.querySelector('[data-task="t2"]')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Keep it here' })).toBeNull();
  });

  it('once dismissed, says so with its title and offers no buttons', () => {
    pushState(
      createShinsaState({
        tasks: [createTask({ id: 't', suggestions: [suggestion({ status: 'dismissed' })] })],
      })
    );
    const view = renderMessage();
    expect(view.getByText('Dismissed')).toBeTruthy();
    expect(view.getByText('Stage the docs and skills files')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Make it a task' })).toBeNull();
  });

  it('shows no card while the state has not arrived or the suggestion is gone', () => {
    const view = renderMessage();
    expect(view.queryByText('Suggested as a separate task')).toBeNull();
    view.unmount();
    pushState(createShinsaState({ tasks: [createTask({ id: 't' })] }));
    expect(renderMessage().queryByText('Suggested as a separate task')).toBeNull();
  });
});
