import { afterEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { FindingVerdictChoice, hasOpenReviewGate } from '@/components/review/verdict-choice.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

afterEach(() => {
  stopFakeServer();
});

const TASK = createTask({
  id: 'verdict-task',
  findings: [
    { severity: 'blocking', file: 'a.ts', line: 1, message: 'Breaks.' },
    { severity: 'optional', file: 'a.ts', line: 2, message: 'Tidy.' },
  ],
});

function renderChoices() {
  return render(
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey='gate-verdicts'>
        <div data-testid='first'>
          <FindingVerdictChoice task={TASK} finding={0} />
        </div>
        <div data-testid='second'>
          <FindingVerdictChoice task={TASK} finding={0} />
        </div>
        <FindingVerdictChoice task={TASK} finding={null} />
      </ReviewDraftProvider>
    </TooltipProvider>
  );
}

describe('FindingVerdictChoice', () => {
  it('shows Fix and Dismiss at a review gate, shared with every other place the finding shows', () => {
    startFakeServer();
    pushState(
      createShinsaState({ tasks: [TASK], gates: [createGate({ id: 'gate-verdicts', taskId: TASK.id })] })
    );
    renderChoices();
    const tabs = screen.getAllByRole('tab', { name: 'Fix' });
    expect(tabs).toHaveLength(2);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'true']);
    expect(tabs.every((tab) => tab.closest('[role="tablist"]')?.querySelector('[data-motion="move"]'))).toBe(
      true
    );
    fireEvent.click(screen.getAllByRole('tab', { name: 'Dismiss' })[0] as HTMLElement);
    expect(
      screen.getAllByRole('tab', { name: 'Dismiss' }).map((tab) => tab.getAttribute('aria-selected'))
    ).toEqual(['true', 'true']);
  });

  it('shows nothing when no review gate is open', () => {
    startFakeServer();
    pushState(
      createShinsaState({
        tasks: [TASK],
        gates: [createGate({ id: 'gate-merge', taskId: TASK.id, type: 'merge' })],
      })
    );
    renderChoices();
    expect(screen.queryByRole('tab', { name: 'Fix' })).toBeNull();
  });
});

describe('hasOpenReviewGate', () => {
  it('reads whether the task waits on a review', () => {
    const state = createShinsaState({
      tasks: [TASK],
      gates: [createGate({ id: 'g', taskId: TASK.id, status: 'answered' })],
    });
    expect(hasOpenReviewGate(state, TASK.id)).toBe(false);
  });
});
