import { describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import { MessageQueue } from '@/components/chat/message-queue.tsx';
import { createRound } from '../../support/rounds.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const task = createTask({
  id: 't',
  rounds: [
    createRound({ number: 1, status: 'active' }),
    createRound({ number: 2, status: 'waiting', request: 'Add dark mode.' }),
    createRound({ number: 3, status: 'waiting', request: 'And a toggle.' }),
  ],
});

const state = createShinsaState({ tasks: [task] });

function renderQueue(
  onUpdate = mock(() => Promise.resolve(true)),
  onRemove = mock(() => Promise.resolve(true)),
  onSend = mock(() => Promise.resolve(true))
) {
  const view = render(
    <MessageQueue state={state} task={task} onUpdate={onUpdate} onSend={onSend} onRemove={onRemove} />
  );
  return { view, onUpdate, onRemove, onSend };
}

describe('MessageQueue', () => {
  it('shows nothing when no message waits', () => {
    const view = render(<MessageQueue state={state} task={createTask({ id: 'plain' })} />);
    expect(view.container.textContent).toBe('');
  });

  it('lists each queued message under when the queue sends', () => {
    const { view } = renderQueue();
    expect(view.getByRole('region', { name: 'Queued messages' }).textContent).toBe(
      'Queued· Sends once round 1 is finished, one round at a time.Add dark mode.And a toggle.'
    );
  });

  it('edits a message in place: Enter saves the trimmed text, Escape and Cancel leave it as it was', async () => {
    const { view, onUpdate } = renderQueue();
    fireEvent.click(view.getAllByRole('button', { name: 'Edit message' })[0] as HTMLElement);
    const field = view.getByRole('textbox', { name: 'Edit the queued message' });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(view.queryByRole('textbox')).toBeNull();
    fireEvent.click(view.getAllByRole('button', { name: 'Edit message' })[1] as HTMLElement);
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(view.queryByRole('textbox')).toBeNull();
    fireEvent.click(view.getAllByRole('button', { name: 'Edit message' })[0] as HTMLElement);
    const editing = view.getByRole('textbox', { name: 'Edit the queued message' });
    fireEvent.change(editing, { target: { value: '   ' } });
    fireEvent.keyDown(editing, { key: 'Enter', shiftKey: false });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.keyDown(editing, { key: 'a' });
    fireEvent.change(editing, { target: { value: '  Add a light theme.  ' } });
    await act(async () => {
      fireEvent.keyDown(editing, { key: 'Enter', shiftKey: false });
    });
    expect(onUpdate).toHaveBeenCalledWith({ number: 2, text: 'Add dark mode.' }, 'Add a light theme.');
    expect(view.queryByRole('textbox')).toBeNull();
  });

  it('keeps the editor open when the change is refused, and saves from the button too', async () => {
    const { view, onUpdate } = renderQueue(mock(() => Promise.resolve(false)));
    fireEvent.click(view.getAllByRole('button', { name: 'Edit message' })[1] as HTMLElement);
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'And a switch.' } });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Save' }));
    });
    expect(onUpdate).toHaveBeenCalledWith({ number: 3, text: 'And a toggle.' }, 'And a switch.');
    expect(view.getByRole('textbox')).toBeTruthy();
  });

  it('removes a message, dimmed until the server answers', async () => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const onRemove = mock(() => promise);
    const { view } = renderQueue(undefined, onRemove);
    fireEvent.click(view.getAllByRole('button', { name: 'Remove from the queue' })[1] as HTMLElement);
    expect(onRemove).toHaveBeenCalledWith({ number: 3, text: 'And a toggle.' });
    const row = view.container.querySelectorAll('[data-queued-message]')[1];
    expect(row?.className).toContain('opacity-60');
    await act(async () => {
      resolve(true);
      await promise;
    });
    expect(row?.className).not.toContain('opacity-60');
  });

  it('sends a message now to the current round, dimmed until the server answers', async () => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const onSend = mock(() => promise);
    const { view } = renderQueue(undefined, undefined, onSend);
    fireEvent.click(view.getAllByRole('button', { name: 'Send now' })[0] as HTMLElement);
    expect(onSend).toHaveBeenCalledWith({ number: 2, text: 'Add dark mode.' });
    const row = view.container.querySelectorAll('[data-queued-message]')[0];
    expect(row?.className).toContain('opacity-60');
    await act(async () => {
      resolve(true);
      await promise;
    });
    expect(row?.className).not.toContain('opacity-60');
  });
});
