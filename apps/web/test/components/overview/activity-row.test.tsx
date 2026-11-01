import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { ActivityRow } from '@/components/overview/activity-row.tsx';
import { createShinsaState, createTask } from '../../support/state.ts';

describe('an activity row', () => {
  it('lists the line comments sent with a decision, each with its place', () => {
    const view = render(
      <ul>
        <ActivityRow
          state={createShinsaState({})}
          onOpenRun={() => undefined}
          entry={{
            at: Date.now(),
            actor: 'you',
            kind: 'decision',
            text: 'Asked for changes',
            detail: null,
            evidenceId: null,
            comments: [
              {
                path: 'src/a.ts',
                side: 'new',
                line: 4,
                endLine: 6,
                text: 'Keep the guard.',
              },
              {
                path: 'src/b.ts',
                side: 'new',
                line: 2,
                endLine: null,
                text: 'Make it a constant.',
              },
            ],
          }}
        />
      </ul>
    );
    expect(view.getByText('src/a.ts:4-6')).toBeTruthy();
    expect(view.getByText('Keep the guard.')).toBeTruthy();
    expect(view.getByText('src/b.ts:2')).toBeTruthy();
    expect(view.getByText('Make it a constant.')).toBeTruthy();
  });

  it('tags the guest in a hand-off line and as the actor of what they did, with no @', () => {
    const guest = { id: 'u7', login: 'kai', name: 'Kai Lane', avatarUrl: null };
    const task = createTask({ id: 't', handoff: { at: 1, url: null, guest, claimedAt: 1 } });
    const base = { at: Date.now(), detail: null, evidenceId: null };
    const view = render(
      <ul>
        <ActivityRow
          state={createShinsaState({})}
          task={task}
          onOpenRun={() => undefined}
          entry={{ ...base, actor: 'shinsa', kind: 'stage', text: 'Handed this task to Kai', person: guest }}
        />
        <ActivityRow
          state={createShinsaState({})}
          task={task}
          onOpenRun={() => undefined}
          entry={{ ...base, actor: 'you', kind: 'decision', text: 'Approved the plan', byGuest: 'kai' }}
        />
      </ul>
    );
    const links = view.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual([
      ['KKai', 'https://github.com/kai'],
      ['KKai', 'https://github.com/kai'],
    ]);
    expect(view.container.textContent).toContain('Handed this task to KKai');
    expect(view.container.textContent).not.toContain('@');
  });
});
