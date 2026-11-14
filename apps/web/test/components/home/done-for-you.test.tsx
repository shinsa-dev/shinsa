import { describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import { DoneForYou } from '@/components/home/done-for-you.tsx';
import { spyOnEngine } from '../../support/engine.ts';
import { createGate, createShinsaState, createTask, NOW } from '../../support/state.ts';

const REASON =
  'The change is small, every check passed and the reviewer found nothing to fix in the new route.';

describe('DoneForYou', () => {
  it('hands the row its summary and reason as plain text, so the tooltip of a cut-off row can wrap', () => {
    spyOnEngine();
    const state = createShinsaState({
      tasks: [createTask({ id: 't-1', title: 'Paint the button', stage: 'merged' })],
      gates: [
        createGate({
          id: 'g-merge',
          taskId: 't-1',
          type: 'merge',
          status: 'answered',
          answeredAt: NOW,
          autopilotAnswer: REASON,
        }),
      ],
    });
    render(
      <TooltipProvider>
        <DoneForYou state={state} />
      </TooltipProvider>
    );
    const meta = screen.getByText(`Autopilot merged it for you. ${REASON}`);
    expect(meta.getAttribute('data-slot')).toBe('truncate');
    expect(meta.querySelector('.truncate')).toBeNull();
  });
});
