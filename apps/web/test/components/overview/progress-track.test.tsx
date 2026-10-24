import { describe, expect, it } from 'bun:test';
import type { DisplayPhase, TaskProgress } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, within } from '@testing-library/react';
import { ProgressTrack } from '@/components/overview/progress-track.tsx';

function phase(key: string, title: string, status: DisplayPhase['status']): DisplayPhase {
  return { key, title, detail: null, status, planned: false };
}

function renderTrack(phases: DisplayPhase[]) {
  const progress: TaskProgress = { phases, current: null, position: 0, total: phases.length, done: 0 };
  const view = render(
    <TooltipProvider>
      <ProgressTrack progress={progress} />
    </TooltipProvider>
  );
  return within(view.getByRole('list', { name: 'Progress' }));
}

describe('ProgressTrack', () => {
  it('marks a skipped step as skipped, not with the check a finished step gets', () => {
    const track = renderTrack([
      phase('plan', 'Plan', 'done'),
      phase('check', 'Checks', 'skipped'),
      phase('review', 'Your review', 'pending'),
    ]);
    const plan = within(track.getByText('Plan').closest('li') as HTMLElement);
    const checks = within(track.getByText('Checks').closest('li') as HTMLElement);
    expect(plan.getByLabelText('Done')).toBeTruthy();
    expect(checks.getByLabelText('Skipped')).toBeTruthy();
    expect(checks.queryByLabelText('Done')).toBeNull();
  });
});
