import { describe, expect, it } from 'bun:test';
import type { SlackThreadLink } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { render, screen } from '@testing-library/react';
import { TaskSlackThread } from '@/components/task/slack-thread.tsx';
import { createTask } from '../../support/state.ts';

const LINK: SlackThreadLink = {
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '100.1',
  userId: 'U1',
  messageTs: '100.2',
  permalink: 'https://acme.slack.com/archives/C1/p1002?thread_ts=100.1',
  statusTs: null,
  reaction: null,
};

function renderThread(slack: SlackThreadLink | null) {
  return render(
    <TooltipProvider>
      <TaskSlackThread task={createTask({ id: 't1', slack })} />
    </TooltipProvider>
  );
}

describe('TaskSlackThread', () => {
  it('links a task started from Slack to its thread in a new tab', () => {
    renderThread(LINK);
    const link = screen.getByRole('button', { name: 'Open the Slack thread' });
    expect(link.getAttribute('href')).toBe(LINK.permalink);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('opens the thread in Slack’s web client when the mention had no permalink', () => {
    renderThread({ ...LINK, permalink: null });
    const link = screen.getByRole('button', { name: 'Open the Slack thread' });
    expect(link.getAttribute('href')).toBe('https://app.slack.com/client/T1/C1/thread/C1-100.1');
  });

  it('shows nothing for a task not started from Slack', () => {
    const { container } = renderThread(null);
    expect(container.querySelector('a')).toBeNull();
  });
});
