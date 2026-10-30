import { describe, expect, it } from 'bun:test';
import type { DisplayPhase, TaskProgress } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, within } from '@testing-library/react';
import { ProgressTrack, TaskTrack } from '@/components/overview/progress-track.tsx';
import { findTooltipText } from '../../support/hover.ts';
import { createTask } from '../../support/state.ts';

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

  it('marks the step a cancelled task stopped at as cancelled and keeps the steps before it done', () => {
    const track = renderTrack([
      phase('pull-request', 'Pull request', 'done'),
      phase('merge', 'Merge', 'cancelled'),
    ]);
    const merge = within(track.getByText('Merge').closest('li') as HTMLElement);
    expect(
      within(track.getByText('Pull request').closest('li') as HTMLElement).getByLabelText('Done')
    ).toBeTruthy();
    expect(merge.getByLabelText('Cancelled')).toBeTruthy();
    expect(merge.queryByLabelText('Done')).toBeNull();
  });

  it('says the conflict the agent resolves in the pull request step, not In progress', async () => {
    const task = createTask({
      id: 't',
      repoId: 'repo-1',
      stage: 'fixing',
      fixFor: 'conflict',
      stageReason: 'resolving conflicts with main',
    });
    const view = render(
      <TooltipProvider>
        <TaskTrack task={task} />
      </TooltipProvider>
    );
    const step = within(view.getByRole('list', { name: 'Progress' })).getByText('Pull request');
    const tooltip = await findTooltipText(step.closest('li') as HTMLElement);
    expect(tooltip).toContain('Resolving conflicts with main');
    expect(tooltip).not.toContain('In progress');
  });
});
