import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { describePlanCard, requestRemoveFromBacklog } from '@/lib/tasks/backlog.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createTask } from '../../support/state.ts';

describe('describePlanCard', () => {
  it('asks for your go-ahead on a plan that waits for you', () => {
    expect(describePlanCard(createTask({ id: 't', stage: 'awaiting_plan' }))).toEqual({
      title: 'The agent wants your go-ahead on this plan',
      approve: 'Approve plan',
      note: 'Want something different? Say it in the chat and the agent revises it.',
    });
  });

  it('offers to start building a plan kept in the backlog, or to start an operation', () => {
    const parked = createTask({ id: 't', stage: 'awaiting_plan', backlog: { at: 1 } });
    expect(describePlanCard(parked)).toMatchObject({
      title: 'Planned and kept in the backlog',
      approve: 'Start building',
    });
    const operation = {
      ...parked,
      pipeline: ['plan', 'operate'] as Parameters<typeof createTask>[0]['pipeline'],
    };
    expect(describePlanCard(operation).approve).toBe('Start the operation');
  });
});

describe('requestRemoveFromBacklog', () => {
  let spies: ReturnType<typeof spyOnCommands>;

  beforeEach(() => {
    spies = spyOnCommands();
  });

  afterEach(() => {
    spies.restore();
  });

  it('sends the task back to Needs you', () => {
    requestRemoveFromBacklog(createTask({ id: 't', backlog: { at: 1 } }));
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.remove_from_backlog', taskId: 't' }, 'Moved back to Needs you.'],
    ] as never);
  });
});
