import { describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import { resolveStatusCard, resolveStatusTimeline, STATUS_UPDATE } from '@/lib/share/status.ts';
import { createTask } from '../../support/state.ts';
import { createSharedTask } from './fixtures.ts';

describe('the status card', () => {
  it('shows the title, the customer update in its words and tone, and no description before one is written', () => {
    const card = resolveStatusCard(
      createTask({
        id: 't',
        title: 'Fix export',
        request: 'Exports fail on Safari.',
        stage: 'building',
        stageChangedAt: 5,
        updatedAt: 9,
      }),
      createSharedTask({ update: 'working' })
    );
    expect(card).toEqual({
      title: 'Fix export',
      stage: { label: 'In progress', tone: 'blue' },
      description: null,
      latest: 'We’re working on it.',
      timeline: resolveStatusTimeline('working'),
      updatedAt: 5,
    });
  });

  it('says deploying, not live, while the change waits for production', () => {
    const task = createTask({ id: 't', stage: 'merged' });
    const deploying = resolveStatusCard(task, createSharedTask({ update: 'deploying' }));
    expect(deploying.stage.label).toBe('Deploying');
    expect(deploying.latest).toContain('isn’t live yet');
    expect(resolveStatusCard(task, createSharedTask({ update: 'live' })).latest).toBe(
      STATUS_UPDATE.live.text
    );
  });

  it('falls back to in progress for a share sent without an update', () => {
    expect(resolveStatusCard(createTask({ id: 't' }), createSharedTask()).stage.label).toBe('In progress');
  });

  it('describes the task by the summary written when it was shared, never its request or plan', () => {
    const task = createTask({ id: 't', request: 'Exports fail on Safari.' });
    const plan = {
      version: 1,
      body: '',
      document: { goal: 'Make exports work.' },
    } as unknown as Task['plan'];
    const shared = createSharedTask({ description: 'Exports now work on Safari.' });
    expect(resolveStatusCard({ ...task, plan }, shared).description).toBe('Exports now work on Safari.');
  });

  it('shows a change’s timeline in customer steps, done up to where it stands', () => {
    const steps = (update: Parameters<typeof resolveStatusTimeline>[0]) =>
      resolveStatusTimeline(update).map((step) => `${step.label}:${step.status}`);
    expect(steps('deploying')).toEqual([
      'Planning:done',
      'In progress:done',
      'In review:done',
      'Deploying:current',
      'Live:pending',
    ]);
    expect(steps('live').every((step) => step.endsWith(':done'))).toBe(true);
  });

  it('shows an inquiry as looking into it then answered, and a closed or done task as one step', () => {
    const steps = (update: Parameters<typeof resolveStatusTimeline>[0]) =>
      resolveStatusTimeline(update).map((step) => `${step.label}:${step.status}`);
    expect(steps('looking_into')).toEqual(['Looking into it:current', 'Answered:pending']);
    expect(steps('answered')).toEqual(['Looking into it:done', 'Answered:done']);
    expect(steps('closed')).toEqual(['Closed:cancelled']);
    expect(steps('done')).toEqual(['Done:done']);
  });
});
