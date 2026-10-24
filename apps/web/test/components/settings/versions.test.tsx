import { describe, expect, it, mock } from 'bun:test';
import type { ProgramId } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { type VersionActions, VersionsGroup } from '@/components/settings/versions.tsx';
import { createProgram, createVersions } from '../../support/versions.ts';

function renderGroup(props: Partial<Parameters<typeof VersionsGroup>[0]> = {}) {
  const actions: VersionActions = {
    refresh: mock(() => Promise.resolve()),
    update: mock((_program: ProgramId) => Promise.resolve()),
  };
  render(
    <TooltipProvider>
      <VersionsGroup snapshot={createVersions()} failure={null} updating={[]} actions={actions} {...props} />
    </TooltipProvider>
  );
  return actions;
}

describe('the Versions settings', () => {
  it('lists each program and the SDK, and Update runs the updater of the one that is behind', () => {
    const actions = renderGroup();
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('Update available')).toBeTruthy();
    expect(screen.getByText('Latest 0.3.310 · Pairs with Claude Code 2.1.280')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Update' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(actions.update).toHaveBeenCalledWith('claude');
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(actions.refresh).toHaveBeenCalled();
  });

  it('a running update keeps its button busy, and an outdated program warns', () => {
    renderGroup({
      snapshot: createVersions({
        programs: [createProgram({ status: 'outdated', version: '2.1.100' })],
      }),
      updating: ['claude'],
    });
    expect(screen.getByText('Update needed')).toBeTruthy();
    expect(screen.getByText('Update').closest('button')?.getAttribute('aria-busy')).toBe('true');
  });

  it('says it is checking, or why it could not', () => {
    renderGroup({ snapshot: null });
    expect(screen.getByText('Checking the versions…')).toBeTruthy();
    renderGroup({ snapshot: null, failure: 'Couldn’t reach Shinsa.' });
    expect(screen.getByText('Couldn’t reach Shinsa.')).toBeTruthy();
  });
});
