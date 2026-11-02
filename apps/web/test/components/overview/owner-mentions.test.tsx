import { describe, expect, it } from 'bun:test';
import type { Iteration } from '@shinsa/core';
import { render } from '@testing-library/react';
import { NowFrame } from '@/components/overview/now-frame.tsx';
import { WorkingRequest } from '@/components/overview/reply-report.tsx';
import { ReadOnlyProvider } from '@/components/task/read-only.tsx';
import { describeResultTitle } from '@/lib/overview/now.ts';

const KAI = { name: 'Kai', user: { login: 'kai', name: 'Kai Lane', avatarUrl: null } };

const WORKING: Iteration = {
  id: 'i1',
  round: 1,
  requests: [{ text: 'Move Slack to General.', comments: 0, at: 1 }],
  reply: null,
  runId: null,
  repliedAt: null,
};

describe('the owner on a teammate’s overview', () => {
  it('tags the owner in the now card’s title and keeps a plain title as markdown', () => {
    const view = render(
      <>
        <NowFrame eyebrow='Done' title={describeResultTitle('answer', KAI)} />
        <NowFrame eyebrow='Done' title='Wrote **the** report' />
      </>
    );
    expect(view.getByRole('link').getAttribute('href')).toBe('https://github.com/kai');
    expect(view.container.textContent).toContain('Answered KKai’s question');
    expect(view.getByText('the').tagName).toBe('STRONG');
  });

  it('tags the owner over the request the agent is working on', () => {
    const view = render(
      <ReadOnlyProvider owner={KAI}>
        <WorkingRequest iteration={WORKING} />
      </ReadOnlyProvider>
    );
    expect(view.getByRole('link').textContent).toBe('KKai’s');
    expect(view.container.textContent).toContain('KKai’s request');
  });

  it('says your request on your own task', () => {
    const view = render(<WorkingRequest iteration={WORKING} />);
    expect(view.getByText('Your request')).toBeTruthy();
    expect(view.queryByRole('link')).toBeNull();
  });
});
