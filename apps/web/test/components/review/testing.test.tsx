import { describe, expect, it } from 'bun:test';
import type { Coverage } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { TestingPanel } from '@/components/review/testing.tsx';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { createFullCoverage, createPartialCoverage } from '../../support/coverage.ts';
import { createTask } from '../../support/state.ts';

const TASK = createTask({ id: 't', handle: 'SW-7', repoId: 'web' });

function renderPanel(coverage: Coverage | null) {
  return render(
    <TooltipProvider>
      <TestingPanel
        persistId={createDisclosureId('task', 't', 'review', 'panel', 'testing')}
        task={TASK}
        testing={null}
        checks={[]}
        coverage={coverage}
      />
    </TooltipProvider>
  );
}

describe('How to test: coverage', () => {
  it('sums up the changed lines the tests run, with each file and the lines they miss behind a toggle', () => {
    renderPanel(createPartialCoverage());
    expect(screen.getByText('Covered by tests')).toBeDefined();
    expect(
      screen.getByText('85% of changed lines are covered (36 of 42) · 2 files have uncovered lines.')
    ).toBeDefined();
    expect(screen.queryByText('src/billing/proration.ts')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 files' }));
    expect(screen.getByRole('button', { name: 'Hide 3 files' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('10 of 14 lines')).toBeDefined();
    expect(screen.getByText('40–42').closest('a')?.getAttribute('href')).toBe(
      '/tasks/SW-7?tab=code&mode=changes&file=src%2Fbilling%2Fproration.ts&diff=1&line=40&end=42'
    );
    expect(screen.getByText('57').closest('a')?.getAttribute('href')).toContain('line=57');
    expect(screen.getAllByText('Not covered:')).toHaveLength(2);
  });

  it('keeps the files open when the panel mounts again, and keeps the panel folded too', () => {
    const first = renderPanel(createPartialCoverage());
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 files' }));
    first.unmount();
    const again = renderPanel(createPartialCoverage());
    expect(screen.getByRole('button', { name: 'Hide 3 files' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse how to test' }));
    again.unmount();
    renderPanel(createPartialCoverage());
    expect(screen.queryByText('Covered by tests')).toBeNull();
  });

  it('shows the fully covered summary, and no panel at all when nothing was measured', () => {
    const { unmount } = renderPanel(createFullCoverage());
    expect(screen.getByText('All 42 changed lines are covered.')).toBeDefined();
    unmount();
    renderPanel({ status: 'unavailable', command: 'bun test', reason: 'No report.' });
    expect(screen.queryByText('Covered by tests')).toBeNull();
  });
});
