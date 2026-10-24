import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { ActivityRow } from '@/components/overview/activity-row.tsx';
import { createShinsaState } from '../../support/state.ts';

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
                suggestion: null,
              },
              {
                path: 'src/b.ts',
                side: 'new',
                line: 2,
                endLine: null,
                text: '',
                suggestion: { original: 'let a;', replacement: 'const a = 1;' },
              },
            ],
          }}
        />
      </ul>
    );
    expect(view.getByText('src/a.ts:4-6')).toBeTruthy();
    expect(view.getByText('Keep the guard.')).toBeTruthy();
    expect(view.getByText('src/b.ts:2')).toBeTruthy();
    expect(view.getByText('Suggested change')).toBeTruthy();
  });
});
