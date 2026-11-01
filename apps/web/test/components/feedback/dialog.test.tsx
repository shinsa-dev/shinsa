import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { Feedback } from '@shinsa/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FeedbackDialog } from '@/components/feedback/dialog.tsx';
import { openFeedbackEntry, selectOpenFeedbackEntryId } from '@/lib/feedback.ts';
import { createActions, createFeedback, stateWith } from '../../support/feedback.ts';

function renderDialog(entries: Feedback[], actions = createActions()) {
  const first = entries[0];
  if (first) act(() => openFeedbackEntry(first.id));
  const view = render(<FeedbackDialog state={stateWith(entries)} actions={actions} />);
  return { actions, view };
}

afterEach(() => {
  mock.restore();
});

describe('FeedbackDialog', () => {
  it('stays closed until you open an entry', () => {
    renderDialog([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the whole draft and opens it as an issue, then closes', async () => {
    const draft = createFeedback({ id: 'f1' });
    const { actions } = renderDialog([draft]);
    await waitFor(() => expect(screen.getByText('Review the issue')).toBeTruthy());
    expect(screen.getByRole('dialog').textContent).toContain('under your GitHub account');
    expect(screen.getByText(draft.body ?? '')).toBeTruthy();
    expect(screen.getByText('From you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open issue' }));
    await waitFor(() => expect(actions.file).toHaveBeenCalledWith(draft));
    expect(selectOpenFeedbackEntryId()).toBeNull();
  });

  it('dismisses it, and stays open when dismissing fails', async () => {
    const actions = createActions();
    actions.dismiss.mockResolvedValue(false);
    const draft = createFeedback({ id: 'f1' });
    renderDialog([draft], actions);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(actions.dismiss).toHaveBeenCalledWith(draft));
    expect(selectOpenFeedbackEntryId()).toBe('f1');
  });

  it('marks an agent report with its task', async () => {
    renderDialog([createFeedback({ id: 'f1', source: 'agent', taskId: 't1' })]);
    await screen.findByText('From the agent on');
    expect(document.querySelector('[data-task="t1"]')?.getAttribute('href')).toBe('/tasks/t1');
  });

  it('warns about private details and refuses to open the issue until they are gone', async () => {
    renderDialog([createFeedback({ id: 'f1', title: 'Basket plans fail' })]);
    expect(await screen.findByText(/a name from your projects \(“Basket”\)/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Open issue' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits the title and description, and checks them before saving', async () => {
    const draft = createFeedback({ id: 'f1' });
    const { actions } = renderDialog([draft]);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Issue title'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('The issue needs a title and a description.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Issue title'), { target: { value: 'New title' } });
    fireEvent.change(screen.getByLabelText('Issue description'), { target: { value: 'New body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByLabelText('Issue title')).toBeNull());
    expect(actions.update).toHaveBeenCalledWith(draft, 'New title', 'New body');
  });

  it('keeps the editor open when saving fails, and Cancel closes it', async () => {
    const actions = createActions();
    actions.update.mockResolvedValue(false);
    renderDialog([createFeedback({ id: 'f1' })], actions);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Issue title')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Issue title')).toBeNull();
  });

  it('shows the note while your agent drafts, and nothing to open yet', async () => {
    renderDialog([createFeedback({ id: 'f1', status: 'drafting', title: null, body: null })]);
    expect(await screen.findByText('Your agent is drafting the issue.')).toBeTruthy();
    expect(screen.getByText('The plan tool refused a plan with two phases.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says it is opening the issue while it does', async () => {
    renderDialog([createFeedback({ id: 'f1', status: 'filing' })]);
    expect(await screen.findByText('Opening the issue on GitHub.')).toBeTruthy();
  });

  it('shows a failure and drafts the note again when no draft came back', async () => {
    const failed = createFeedback({
      id: 'f1',
      status: 'failed',
      title: null,
      body: null,
      failure: 'No draft came back.',
    });
    const { actions } = renderDialog([failed]);
    expect(await screen.findByText('No draft came back.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Draft again' }));
    expect(actions.write).toHaveBeenCalledWith('f1', failed.note);
  });

  it('closes when the entry it shows is gone', async () => {
    const draft = createFeedback({ id: 'f1' });
    const { view } = renderDialog([draft]);
    await screen.findByText('Review the issue');
    view.rerender(<FeedbackDialog state={stateWith([])} actions={createActions()} />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open issue' })).toBeNull());
  });
});
