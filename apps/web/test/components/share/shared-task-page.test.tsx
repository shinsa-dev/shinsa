import { describe, expect, it } from 'bun:test';
import type { Activity, Task } from '@shinsa/core';
import { render, screen } from '@testing-library/react';
import { SharedTaskPage } from '@/components/share/shared-task-page.tsx';
import { resolveSharedView } from '@/lib/share/view.ts';
import { createSharedTask } from '../../lib/share/fixtures.ts';
import { createTask } from '../../support/state.ts';

const ASKED: Activity = {
  at: 1,
  actor: 'you',
  kind: 'asked',
  text: 'Asked for this',
  detail: null,
  evidenceId: null,
};

function renderShared(owner: string | null, viewer: string | null, overrides: Partial<Task> = {}) {
  const task = createTask({
    id: 'task-1',
    handle: 'SW-34',
    title: 'Rotate API keys',
    activity: [ASKED],
    ...overrides,
  });
  const view = resolveSharedView({
    shared: createSharedTask({ task, evidence: [], owner, gates: [], runs: [] }),
    updatedAt: 1,
    resolveFileUrl: () => null,
  });
  return render(<SharedTaskPage view={view} note='Read-only' viewer={viewer} />);
}

function readAskedLine() {
  return screen.getByText('Asked for this').closest('li')?.textContent ?? '';
}

describe('the owner on a shared task page', () => {
  it('names the owner by their login for a teammate', () => {
    const { unmount } = renderShared('kai', 'mona');
    expect(readAskedLine()).toContain('@kai ·');
    expect(readAskedLine()).not.toContain('You');
    unmount();
  });

  it('names the owner for a visitor who is not signed in', () => {
    const { unmount } = renderShared('kai', null);
    expect(readAskedLine()).toContain('@kai ·');
    unmount();
  });

  it('says the owner when the share has no login', () => {
    const { unmount } = renderShared(null, 'mona');
    expect(readAskedLine()).toContain('The owner ·');
    unmount();
  });

  it('still says you to the owner', () => {
    const { unmount } = renderShared('Kai', 'kai');
    expect(readAskedLine()).toContain('You ·');
    expect(screen.getByText('Shared by you from Studio')).toBeTruthy();
    unmount();
  });

  it('names the owner who cancelled the task and whose request the agent works on', () => {
    const cancelled = renderShared('kai', 'mona', {
      repoId: 'repo-1',
      stage: 'cancelled',
      cancelledFrom: 'planning',
      stageReason: 'cancelled by you',
    });
    expect(screen.getByText('Cancelled at Plan: @kai cancelled the task.')).toBeTruthy();
    cancelled.unmount();
    const fixing = renderShared('kai', 'mona', {
      stage: 'fixing',
      iterations: [
        {
          id: 'i',
          round: 1,
          requests: [{ text: 'Use the new key', comments: 0, at: 1 }],
          reply: null,
          runId: null,
          repliedAt: null,
        },
      ],
    });
    expect(screen.getByText('@kai’s request')).toBeTruthy();
    expect(screen.queryByText('Your request')).toBeNull();
    fixing.unmount();
  });
});
