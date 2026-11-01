import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Feedback } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FeedbackButton } from '@/components/feedback/button.tsx';
import { FeedbackPanel } from '@/components/feedback/popover.tsx';
import { isFeedbackOpen, openFeedback, selectOpenFeedbackEntryId } from '@/lib/feedback.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { createActions, createFeedback, stateWith } from '../../support/feedback.ts';

function renderPanel(entries: Feedback[], actions = createActions()) {
  const onOpen = mock((_entry: Feedback) => {});
  render(<FeedbackPanel state={stateWith(entries)} actions={actions} onOpen={onOpen} />);
  return { actions, onOpen };
}

afterEach(() => {
  mock.restore();
});

describe('FeedbackPanel', () => {
  it('says what happens to your note, and that agents report here too', () => {
    renderPanel([]);
    expect(screen.getByText('Feedback on Shinsa')).toBeTruthy();
    expect(document.body.textContent).toContain(
      'public GitHub issue on shinsa-dev/shinsa, without anything private. You read it before it opens under your GitHub account.'
    );
    expect(screen.getByText(/Agents report what gets in their way/)).toBeTruthy();
  });

  it('sends a note for your agent to draft and clears the field', async () => {
    const { actions } = renderPanel([]);
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
    const { actions } = renderPanel([]);
    fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'x'.repeat(4_001) } });
    fireEvent.submit(screen.getByLabelText('Your feedback').closest('form') as HTMLFormElement);
    expect(screen.getByText('Keep it to 4000 characters. It has 4001.')).toBeTruthy();
    expect(actions.write).not.toHaveBeenCalled();
  });

  it('lists each waiting entry as one row with who it is from, and opens it', () => {
    const draft = createFeedback({ id: 'f1' });
    const { onOpen } = renderPanel([
      draft,
      createFeedback({ id: 'f2', source: 'agent', taskId: 't1', title: 'Refused hand-overs' }),
      createFeedback({ id: 'f3', status: 'drafting', title: null, body: null }),
    ]);
    expect(screen.getByText('From you')).toBeTruthy();
    expect(screen.getByText('From the agent on Fix the login page')).toBeTruthy();
    expect(screen.getByText('Your agent is drafting it')).toBeTruthy();
    expect(screen.queryByText(draft.body ?? '')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open feedback: Plans with two phases are refused' }));
    expect(onOpen).toHaveBeenCalledWith(draft);
  });

  it('lists the opened issues with their links, who sent each, and marks a closed one', () => {
    renderPanel([
      createFeedback({
        id: 'f1',
        status: 'filed',
        issue: {
          number: 42,
          url: 'https://github.com/shinsa-dev/shinsa/issues/42',
          openedAt: 1,
          closedAt: null,
        },
      }),
      createFeedback({
        id: 'f2',
        source: 'agent',
        title: 'Reviews skip the last phase',
        status: 'filed',
        issue: {
          number: 41,
          url: 'https://github.com/shinsa-dev/shinsa/issues/41',
          openedAt: 1,
          closedAt: 2,
        },
      }),
    ]);
    expect(screen.getByText('Opened on GitHub')).toBeTruthy();
    const open = screen.getByRole('link', { name: /#42/ });
    expect(open.getAttribute('href')).toBe('https://github.com/shinsa-dev/shinsa/issues/42');
    expect(open.textContent).toContain('From you');
    expect(open.textContent).not.toContain('Closed');
    const closed = screen.getByRole('link', { name: /#41/ });
    expect(closed.textContent).toContain('From an agent');
    expect(closed.textContent).toContain('Closed');
  });
});

describe('FeedbackButton', () => {
  beforeEach(() => {
    spyOnEngine();
  });

  it('is left out on an engine that does not take feedback', () => {
    spyOnEngine(null);
    render(
      <TooltipProvider>
        <FeedbackButton state={stateWith([])} actions={createActions()} />
      </TooltipProvider>
    );
    expect(screen.queryByRole('button', { name: /Feedback/ })).toBeNull();
  });

  it('opens only the button that was clicked when two are mounted', async () => {
    const state = stateWith([createFeedback({ id: 'f1' })]);
    render(
      <TooltipProvider>
        <FeedbackButton state={state} actions={createActions()} />
        <FeedbackButton state={state} variant='rail' actions={createActions()} />
      </TooltipProvider>
    );
    const [bar, rail] = screen.getAllByRole('button', { name: /Feedback/ });
    fireEvent.click(rail as HTMLElement);
    await waitFor(() => expect(screen.getAllByLabelText('Your feedback')).toHaveLength(1));
    expect(rail?.getAttribute('data-active')).toBe('true');
    expect(bar?.getAttribute('aria-expanded')).not.toBe('true');
  });

  it('opens the popover from the header and shows the waiting count', async () => {
    const state = stateWith([createFeedback({ id: 'f1' }), createFeedback({ id: 'f2', status: 'failed' })]);
    render(
      <TooltipProvider>
        <FeedbackButton state={state} actions={createActions()} />
      </TooltipProvider>
    );
    const button = screen.getByRole('button', { name: /Feedback/ });
    expect(button.textContent).toContain('2');
    fireEvent.click(button);
    expect(isFeedbackOpen()).toBe(true);
    await waitFor(() => expect(screen.getByLabelText('Your feedback')).toBeTruthy());
  });

  it('opens an entry from the rail, closing the popover and the rail', async () => {
    const onNavigate = mock(() => {});
    render(
      <FeedbackButton
        state={stateWith([createFeedback({ id: 'f1' })])}
        variant='rail'
        actions={createActions()}
        onNavigate={onNavigate}
      />
    );
    const item = screen.getAllByRole('button').find((button) => button.textContent === 'Feedback1');
    if (item) item.getClientRects = () => [new DOMRect(0, 0, 100, 24)] as unknown as DOMRectList;
    act(() => openFeedback());
    await waitFor(() => expect(item?.getAttribute('data-active')).toBe('true'));
    const row = await screen.findByRole('button', { name: /Open feedback/ });
    fireEvent.click(row);
    expect(selectOpenFeedbackEntryId()).toBe('f1');
    expect(isFeedbackOpen()).toBe(false);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
