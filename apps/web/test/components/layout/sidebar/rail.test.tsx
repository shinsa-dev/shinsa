import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { CompactBar } from '@/components/layout/sidebar/compact-bar.tsx';
import { Rail } from '@/components/layout/sidebar/rail.tsx';
import { isFeedbackOpen, openFeedback } from '@/lib/feedback.ts';
import { useNewTaskRequest } from '@/lib/new-task.ts';
import { navigate } from '@/router.ts';
import { spyOnEngine } from '../../../support/engine.ts';
import { createGate, createShinsaState, createTask } from '../../../support/state.ts';

beforeEach(() => {
  spyOnEngine();
});

afterEach(() => {
  mock.restore();
});

const STATE = createShinsaState({
  tasks: [createTask({ id: 'review', handle: 'SW-1', title: 'Review the login fix', stage: 'reviewing' })],
  gates: [createGate({ id: 'g-review', taskId: 'review', type: 'review' })],
});

describe('the rail’s queue', () => {
  it('marks the open task on its handle URL', () => {
    act(() => navigate('/tasks/SW-1'));
    render(
      <TooltipProvider>
        <Rail state={STATE} />
      </TooltipProvider>
    );
    expect(screen.getByRole('button', { name: /Review the login fix/ }).getAttribute('aria-current')).toBe(
      'true'
    );
  });
});

function ComposerProbe() {
  const [requested, setRequested] = React.useState(false);
  useNewTaskRequest(() => setRequested(true));
  return requested ? <p>Composer asked for</p> : null;
}

describe('New task', () => {
  for (const [name, shell] of [
    ['the rail', <Rail key='rail' state={STATE} />],
    ['the compact bar', <CompactBar key='bar' state={STATE} onMenu={() => {}} />],
  ] as const) {
    it(`goes Home and asks for the composer from ${name}, as ⌘K’s New task does`, () => {
      act(() => navigate('/tasks/SW-1'));
      render(
        <TooltipProvider>
          {shell}
          <ComposerProbe />
        </TooltipProvider>
      );
      act(() => fireEvent.click(screen.getByRole('button', { name: 'New task' })));
      expect(location.pathname).toBe('/');
      expect(screen.getByText('Composer asked for')).toBeTruthy();
    });
  }

  it('goes Home from the compact bar’s Shinsa', () => {
    act(() => navigate('/tasks/SW-1'));
    render(
      <TooltipProvider>
        <CompactBar state={STATE} onMenu={() => {}} />
      </TooltipProvider>
    );
    act(() => fireEvent.click(screen.getByRole('button', { name: /Shinsa/ })));
    expect(location.pathname).toBe('/');
  });

  it('has Feedback, so ⌘K’s Send feedback opens its popover while the rail is folded away', async () => {
    render(
      <TooltipProvider>
        <CompactBar state={STATE} onMenu={() => {}} />
      </TooltipProvider>
    );
    const button = screen.getByRole('button', { name: /Feedback/ });
    button.getClientRects = () => [new DOMRect(0, 0, 100, 24)] as unknown as DOMRectList;
    act(() => openFeedback());
    expect(isFeedbackOpen()).toBe(true);
    await waitFor(() => expect(screen.getByLabelText('Your feedback')).toBeTruthy());
  });
});
