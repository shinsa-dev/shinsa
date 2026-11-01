import { describe, expect, it } from 'bun:test';
import type { Activity } from '@shinsa/core';
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

function renderShared(owner: string | null, viewer: string | null) {
  const task = createTask({ id: 'task-1', handle: 'SW-34', title: 'Rotate API keys', activity: [ASKED] });
  const view = resolveSharedView({
    shared: createSharedTask({ task, evidence: [], owner }),
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
});
