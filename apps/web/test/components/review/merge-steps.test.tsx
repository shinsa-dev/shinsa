import { describe, expect, it } from 'bun:test';
import type { PhaseReport } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import { MergeStepsPanel } from '@/components/review/merge-steps.tsx';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { createTask } from '../../support/state.ts';

const REPORT = {
  index: 0,
  summary: 'Done.',
  spots: [],
  judgementCalls: [],
  walkthrough: {
    approach: 'A.',
    flow: 'B.',
    risks: [],
    testing: { automated: [], manual: [] },
    steps: [
      { when: 'pre_merge', kind: 'env', title: 'Set A in production', detail: 'In Vercel.', command: null },
    ],
  },
} as unknown as PhaseReport;

const TASK = createTask({ id: 't', handle: 'SW-7', phaseReports: [REPORT] });

function renderPanel(readOnly?: boolean) {
  return render(
    <TooltipProvider>
      <MergeStepsPanel
        persistId={createDisclosureId('task', 't', 'review', 'panel', 'pre_merge')}
        task={TASK}
        when='pre_merge'
        {...(readOnly === undefined ? {} : { readOnly })}
      />
    </TooltipProvider>
  );
}

describe('the steps around the merge', () => {
  it('lets you tick a step on your own task', () => {
    renderPanel();
    expect(screen.getByText('Set A in production')).toBeDefined();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('lists the steps without a box to tick on a read-only page', () => {
    renderPanel(true);
    expect(screen.getByText('Set A in production')).toBeDefined();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
