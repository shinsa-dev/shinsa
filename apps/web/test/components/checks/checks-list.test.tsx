import { describe, expect, it } from 'bun:test';
import type { TaskCheck } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ChecksBlock, ChecksSections } from '@/components/checks/checks-list.tsx';
import { recordEvidenceText } from '@/lib/evidence/texts.ts';
import { type ChecksView, resolveChecksView } from '@/lib/tasks/checks.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createEvidence, createRepo, createShinsaState, createTask } from '../../support/state.ts';

const UNIT: TaskCheck = {
  id: 'c1',
  label: 'Unit tests',
  command: 'bun test a.test.ts',
  phases: [1],
  source: 'plan',
};

const TYPES: TaskCheck = {
  id: 'c2',
  label: 'Types',
  command: 'bun run check-types',
  phases: [1],
  source: 'agent',
};

const OUTPUT = '/api/evidence/checks-list/round-1/unit-tests.txt';

function createView(overrides: Parameters<typeof createTask>[0] extends infer T ? Partial<T> : never) {
  const state = createShinsaState({
    repos: [createRepo({ id: 'repo', checkCommands: ['bun run lint'] })],
    evidence: [createEvidence({ id: 'out', taskId: 't', kind: 'check', checkId: 'c1', uri: OUTPUT })],
  });
  const task = createTask({ id: 't', repoId: 'repo', checks: [UNIT, TYPES], ...overrides });
  return resolveChecksView(state, task) as ChecksView;
}

describe('the Checks list', () => {
  it('shows each check with who added it, its command and outcome, and Shinsa’s output behind a toggle', async () => {
    recordEvidenceText(OUTPUT, ' 3 pass\n 0 fail');
    const view = createView({
      checkResults: [
        { id: 'c1', label: 'Unit tests', command: 'bun test a.test.ts', outcome: 'pass', detail: null },
        {
          id: 'c2',
          label: 'Types',
          command: 'bun run check-types',
          outcome: 'fail',
          detail: 'TS2322 in a.ts',
        },
      ],
    });
    const block = render(
      <TooltipProvider>
        <ChecksBlock taskId='t' view={view} />
      </TooltipProvider>
    );
    expect(screen.getByText('Building')).toBeTruthy();
    expect(screen.getByText('1 of 3 failed')).toBeTruthy();
    expect(screen.getByText('From the plan')).toBeTruthy();
    expect(screen.getByText('Added by the agent')).toBeTruthy();
    expect(screen.getByText('Repository · before review')).toBeTruthy();
    expect(screen.getByText('TS2322 in a.ts')).toBeTruthy();
    expect(screen.getByText('Not run yet')).toBeTruthy();
    expect(block.container.textContent).not.toContain('3 pass');
    fireEvent.click(screen.getByRole('button', { name: 'Show the output' }));
    await waitFor(() => expect(block.container.textContent).toContain('3 pass'));
    expect(screen.getByRole('button', { name: 'Hide the output' }).getAttribute('aria-expanded')).toBe(
      'true'
    );
  });

  it('spins a running check, so a run of the checks never looks stuck', () => {
    const view = createView({
      stage: 'checking',
      stageReason: 'running the checks again after the fix',
      runningChecks: [],
    });
    render(
      <TooltipProvider>
        <ChecksBlock taskId='t' view={view} />
      </TooltipProvider>
    );
    expect(screen.getAllByText('Not run yet').length).toBeGreaterThan(0);
    const running = createView({
      stage: 'checking',
      stageReason: 'running the checks before review',
      runningChecks: ['c1', 'c2', 'r1'],
      phaseReports: [{ index: 1, summary: '', spots: [], judgementCalls: [], at: 0 }],
    });
    render(
      <TooltipProvider>
        <ChecksBlock taskId='t' view={running} />
      </TooltipProvider>
    );
    expect(screen.getByText('Running 3 checks')).toBeTruthy();
    expect(screen.getAllByRole('status', { name: 'Running' })).toHaveLength(3);
  });

  it('shows CI’s checks after the pull request, each linked to its run, in the popover too', () => {
    const view = createView({
      pullRequest: createPullRequest({
        number: 7,
        checks: 'failing',
        checkRuns: [
          { name: 'build', status: 'failure', required: true, url: 'https://ci/build' },
          { name: 'docs', status: 'success', required: false, url: null },
        ],
      }),
    });
    const block = render(
      <TooltipProvider>
        <ChecksBlock taskId='t' view={view} />
      </TooltipProvider>
    );
    expect(within(block.container).getByRole('link', { name: 'build' }).getAttribute('href')).toBe(
      'https://ci/build'
    );
    expect(within(block.container).getByText('Required')).toBeTruthy();
    block.unmount();
    const popover = render(
      <TooltipProvider>
        <ChecksSections view={view} />
      </TooltipProvider>
    );
    expect(within(popover.container).getByText('CI')).toBeTruthy();
    expect(within(popover.container).getByText('1 of 2 failed')).toBeTruthy();
    expect(within(popover.container).getByText('bun run check-types')).toBeTruthy();
  });
});
