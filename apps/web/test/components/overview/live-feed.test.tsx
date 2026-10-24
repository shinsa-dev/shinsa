import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { LiveFeed } from '@/components/overview/live-feed.tsx';
import { createEntry, pushTranscript, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createRun, NOW } from '../../support/state.ts';

const run = createRun({ id: 'run-feed', taskId: 't', startedAt: NOW });

function shimmers(element: Element | undefined) {
  return Boolean(element?.querySelector('.sr-only'));
}

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

describe('LiveFeed', () => {
  it('shimmers Starting before the agent has done anything, and holds still while the run is parked', () => {
    const view = render(<LiveFeed run={run} />);
    expect(view.container.textContent).toBe('StartingStarting');
    expect(shimmers(view.container)).toBe(true);
    view.unmount();
    const parked = render(<LiveFeed run={{ ...run, status: 'waiting' }} />);
    expect(parked.container.textContent).toBe('Starting');
    expect(shimmers(parked.container)).toBe(false);
  });

  it('shimmers only the newest line, in the words of the live step', () => {
    pushTranscript(run.id, [
      createEntry(
        { type: 'agent', phase: 'interim', text: 'Compare project maturity by history' },
        'a1',
        NOW
      ),
      createEntry(
        { type: 'tool_call', callId: 'c1', tool: { kind: 'read', path: 'src/form.ts', range: null } },
        'c1',
        NOW + 1000
      ),
    ]);
    const view = render(<LiveFeed run={run} />);
    const [older, newest] = view.getAllByRole('listitem');
    expect(shimmers(older)).toBe(false);
    expect(older?.textContent).toBe('Compare project maturity by history');
    expect(shimmers(newest)).toBe(true);
    expect(newest?.querySelector('.sr-only')?.textContent).toBe('Reading src/form.ts');
  });
});
