import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  acceptSuggestion,
  dismissSilence,
  dismissSuggestion,
  keepSuggestion,
  requestCheckNow,
  SNOOZE_HINT,
  snoozeSilence,
  stopDelegation,
} from '@/lib/tasks/process.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createTask } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

describe('process actions', () => {
  it('checks a wait now, and snoozes or dismisses a quiet agent for the snooze the engine uses', async () => {
    await requestCheckNow('t');
    await snoozeSilence('r', 1_000);
    await dismissSilence('r');
    await stopDelegation('child');
    expect(SNOOZE_HINT).toBe('30 minutes');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'monitor.check_in_now', taskId: 't' }, 'Checking now.'],
      [{ type: 'run.snooze_silence', runId: 'r', until: 1_000 + 30 * 60_000 }, 'Snoozed for 30 minutes.'],
      [{ type: 'run.dismiss_silence', runId: 'r' }, 'Dismissed for this step.'],
      [{ type: 'delegation.cancel', runId: 'child' }, 'Stopped.'],
    ] as never);
  });

  it('adds a suggested follow-up to start when you chose, whatever the agent suggested, or dismisses it', async () => {
    const task = createTask({ id: 't' });
    const suggestion = { id: 's', title: 'Retry', why: 'Flaky', waitsOnThis: true, status: 'open' as const };
    await acceptSuggestion(task, suggestion as never, 'now');
    await acceptSuggestion(task, { ...suggestion, waitsOnThis: false } as never, 'after');
    await dismissSuggestion(task, suggestion as never);
    await keepSuggestion(task, suggestion as never);
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'suggestion.accept', taskId: 't', suggestionId: 's', waitsOnThis: false },
        'Added to the roadmap. It starts now.',
      ],
      [
        { type: 'suggestion.accept', taskId: 't', suggestionId: 's', waitsOnThis: true },
        'Added to the roadmap. It starts after this task merges.',
      ],
      [{ type: 'suggestion.dismiss', taskId: 't', suggestionId: 's' }, 'Dismissed.'],
      [
        { type: 'suggestion.keep', taskId: 't', suggestionId: 's' },
        'Kept in this task. It starts as the next round.',
      ],
    ] as never);
  });
});
