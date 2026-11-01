import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { Feedback } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FeedbackButton } from '@/components/feedback/button.tsx';
import { FeedbackDialog, FeedbackPanel } from '@/components/feedback/dialog.tsx';
import { type FeedbackActions, isFeedbackOpen, openFeedback } from '@/lib/feedback.ts';
import { createFeedback } from '../../support/feedback.ts';
import { createProject, createShinsaState, createTask } from '../../support/state.ts';

function createActions() {
  return {
    write: mock(async (_feedbackId: string | null, _note: string) => true),
    update: mock(async (_entry: Feedback, _title: string, _body: string) => true),
    file: mock(async (_entry: Feedback) => true),
    dismiss: mock(async (_entry: Feedback) => true),
  } satisfies FeedbackActions;
}

const TASK = createTask({ id: 't1', title: 'Fix the login page' });

function stateWith(entries: Feedback[]) {
  return createShinsaState({
    tasks: [TASK],
    projects: [createProject({ id: 'p1', name: 'Basket', key: 'BK' })],
    patch: { feedback: Object.fromEntries(entries.map((entry) => [entry.id, entry])) },
  });
}

function renderPanel(entries: Feedback[], actions = createActions()) {
  render(
    <TooltipProvider>
      <FeedbackPanel state={stateWith(entries)} actions={actions} />
    </TooltipProvider>
  );
  return actions;
}

afterEach(() => {
  mock.restore();
});

describe('FeedbackPanel', () => {
  it('says nothing waits and that agents report here too', () => {
    renderPanel([]);
    expect(screen.getByText('Nothing waits for you')).toBeTruthy();
    expect(screen.getByText(/Agents report what gets in their way/)).toBeTruthy();
  });

  it('sends a note for your agent to draft and clears the field', async () => {
    const actions = renderPanel([]);
    const field = screen.getByLabelText('Your feedback') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Plans with two phases are refused.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft issue' }));
    await waitFor(() => expect(field.value).toBe(''));
    expect(actions.write).toHaveBeenCalledWith(null, 'Plans with two phases are refused.');
  });

  it('sends the note with ⌘ Enter and keeps it when sending fails', async () => {
    const actions = createActions();
    actions.write.mockResolvedValue(false);
    renderPanel([], actions);
    const field = screen.getByLabelText('Your feedback') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Plans fail.' } });
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(actions.write).toHaveBeenCalledTimes(1));
    expect(field.value).toBe('Plans fail.');
  });

  it('says what is wrong with a note that is too long', () => {
    const actions = renderPanel([]);
    fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'x'.repeat(4_001) } });
    fireEvent.submit(screen.getByLabelText('Your feedback').closest('form') as HTMLFormElement);
    expect(screen.getByText('Keep it to 4000 characters. It has 4001.')).toBeTruthy();
    expect(actions.write).not.toHaveBeenCalled();
  });

  it('shows a draft to read, opens it as an issue or dismisses it', async () => {
    const draft = createFeedback({ id: 'f1' });
    const actions = renderPanel([draft]);
    expect(screen.getByText('Plans with two phases are refused')).toBeTruthy();
    expect(screen.getByText('From you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open issue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(actions.dismiss).toHaveBeenCalledWith(draft));
    expect(actions.file).toHaveBeenCalledWith(draft);
  });

  it('marks an agent report with its task', () => {
    renderPanel([createFeedback({ id: 'f1', source: 'agent', taskId: 't1' })]);
    expect(screen.getByText('From the agent on')).toBeTruthy();
    expect(document.querySelector('[data-task="t1"]')?.getAttribute('href')).toBe('/tasks/t1');
  });

  it('warns about private details and refuses to open the issue until they are gone', () => {
    renderPanel([createFeedback({ id: 'f1', title: 'Basket plans fail' })]);
    expect(screen.getByText(/a name from your projects \(“Basket”\)/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Open issue' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits the title and description, and checks them before saving', async () => {
    const draft = createFeedback({ id: 'f1' });
    const actions = renderPanel([draft]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
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
    renderPanel([createFeedback({ id: 'f1' })], actions);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Issue title')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Issue title')).toBeNull();
  });

  it('shows the note while your agent drafts, and nothing to open yet', () => {
    renderPanel([createFeedback({ id: 'f1', status: 'drafting', title: null, body: null })]);
    expect(screen.getByText('Your agent is drafting the issue.')).toBeTruthy();
    expect(screen.getByText('The plan tool refused a plan with two phases.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says it is opening the issue while it does', () => {
    renderPanel([createFeedback({ id: 'f1', status: 'filing' })]);
    expect(screen.getByText('Opening the issue on GitHub.')).toBeTruthy();
  });

  it('shows a failure and drafts the note again when no draft came back', () => {
    const failed = createFeedback({
      id: 'f1',
      status: 'failed',
      title: null,
      body: null,
      failure: 'No draft came back.',
    });
    const actions = renderPanel([failed]);
    expect(screen.getByText('No draft came back.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Draft again' }));
    expect(actions.write).toHaveBeenCalledWith('f1', failed.note);
  });

  it('lists the opened issues with their links', () => {
    renderPanel([
      createFeedback({
        id: 'f1',
        status: 'filed',
        issue: { number: 42, url: 'https://github.com/shinsa-dev/shinsa/issues/42' },
      }),
    ]);
    expect(screen.getByText('Opened on GitHub')).toBeTruthy();
    expect(screen.getByRole('link', { name: /#42/ }).getAttribute('href')).toBe(
      'https://github.com/shinsa-dev/shinsa/issues/42'
    );
  });
});

describe('FeedbackDialog and FeedbackButton', () => {
  it('opens from the header button, says what happens to your note and shows the waiting count', async () => {
    const state = stateWith([createFeedback({ id: 'f1' }), createFeedback({ id: 'f2', status: 'failed' })]);
    render(
      <TooltipProvider>
        <FeedbackButton state={state} />
        <FeedbackDialog state={state} actions={createActions()} />
      </TooltipProvider>
    );
    const button = screen.getByRole('button', { name: /Feedback/ });
    expect(button.textContent).toContain('2');
    fireEvent.click(button);
    expect(isFeedbackOpen()).toBe(true);
    await waitFor(() => expect(screen.getByText('Feedback on Shinsa')).toBeTruthy());
    expect(screen.getByRole('dialog').textContent).toContain(
      'public GitHub issue on shinsa-dev/shinsa, without anything private. You read it before it opens under your GitHub account.'
    );
  });

  it('opens from the rail and lets the rail close', () => {
    const onNavigate = mock(() => {});
    render(<FeedbackButton state={stateWith([])} variant='rail' onNavigate={onNavigate} />);
    const item = screen.getByRole('button', { name: 'Feedback' });
    expect(item.getAttribute('data-active')).toBe('false');
    fireEvent.click(item);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(item.getAttribute('data-active')).toBe('true');
  });

  it('shows the count in the rail when something waits', () => {
    act(() => openFeedback());
    render(<FeedbackButton state={stateWith([createFeedback({ id: 'f1' })])} variant='rail' />);
    expect(screen.getByRole('button').textContent).toBe('Feedback1');
  });
});
