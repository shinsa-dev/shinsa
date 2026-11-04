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
    ['the More sheet', <Rail key='sheet' state={STATE} variant='sheet' />],
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
        <CompactBar state={STATE} onMore={() => {}} />
      </TooltipProvider>
    );
    act(() => fireEvent.click(screen.getByRole('button', { name: /Shinsa/ })));
    expect(location.pathname).toBe('/');
  });

  it('has Feedback, so ⌘K’s Send feedback opens its popover while the rail is folded away', async () => {
    render(
      <TooltipProvider>
        <CompactBar state={STATE} onMore={() => {}} />
      </TooltipProvider>
    );
    const button = screen.getByRole('button', { name: /Feedback/ });
    button.getClientRects = () => [new DOMRect(0, 0, 100, 24)] as unknown as DOMRectList;
    act(() => openFeedback());
    expect(isFeedbackOpen()).toBe(true);
    await waitFor(() => expect(screen.getByLabelText('Your feedback')).toBeTruthy());
  });
});

describe('the More sheet', () => {
  it('leaves out the queue and search, which the phone bar already has', () => {
    act(() => navigate('/tasks/SW-1'));
    render(
      <TooltipProvider>
        <Rail state={STATE} variant='sheet' />
      </TooltipProvider>
    );
    expect(screen.queryByRole('button', { name: /Review the login fix/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search and actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Feedback/ })).toBeTruthy();
  });
});

describe('the compact bar', () => {
  it('keeps Tasks, the queue, Feedback and search on the bar and opens More for the rest', () => {
    act(() => navigate('/tasks/SW-1'));
    let more = 0;
    render(
      <TooltipProvider>
        <CompactBar state={STATE} onMore={() => (more += 1)} />
      </TooltipProvider>
    );
    expect(screen.getByRole('button', { name: /1 needs you/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search and actions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Tasks' })));
    expect(location.pathname).toBe('/tasks');
    act(() => fireEvent.click(screen.getByRole('button', { name: 'More' })));
    expect(more).toBe(1);
  });

  it('shows only the way home during setup', () => {
    act(() => navigate('/onboarding'));
    render(
      <TooltipProvider>
        <CompactBar state={STATE} onMore={() => {}} />
      </TooltipProvider>
    );
    expect(screen.queryByRole('button', { name: 'Tasks' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });
});
