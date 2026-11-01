import { describe, expect, test } from 'bun:test';
import {
  isTaskSettled,
  listActiveRuns,
  listOpenGates,
  replayEventLog,
  selectWelcomeTask,
  WELCOME_TASK,
} from '../../src/index.ts';
import { createHarness } from '../harness.ts';

const BODY = 'Welcome to Shinsa. You chose ~/Developer and signed in to Claude.';

function welcome() {
  const harness = createHarness();
  const decision = harness.send({ type: 'onboarding.welcome', body: BODY });
  const task = selectWelcomeTask(harness.state.tasks);
  if (!task) throw new Error('no welcome task');
  return { harness, decision, task };
}

describe('the welcome task', () => {
  test('is a done answer with the summary as its result', () => {
    const { task } = welcome();
    expect(task).toMatchObject({
      title: WELCOME_TASK.title,
      request: WELCOME_TASK.request,
      origin: WELCOME_TASK.origin,
      repoId: null,
      branch: null,
      mode: 'ask',
      stage: 'done',
      stageReason: 'setup is finished',
      handle: 'T-1',
      result: { step: 'answer', body: BODY, runId: null },
    });
    expect(isTaskSettled(task)).toBe(true);
    expect(task.activity.map((entry) => [entry.actor, entry.text])).toEqual([
      ['you', 'Asked a question'],
      ['shinsa', 'Set up as a question'],
      ['shinsa', 'Answered the question'],
      ['shinsa', 'Marked done'],
    ]);
  });

  test('starts no triage, agent, worktree or gate', () => {
    const { harness, decision, task } = welcome();
    expect(decision.events.map((event) => event.type)).toEqual([
      'task.created',
      'task.triaged',
      'task.delivered',
      'task.staged',
    ]);
    expect(decision.effects.filter((effect) => 'taskId' in effect && effect.taskId === task.id)).toEqual([]);
    expect(listActiveRuns(harness.state, task.id)).toEqual([]);
    expect(listOpenGates(harness.state, task.id)).toEqual([]);
  });

  test('replays to the same task from the log', () => {
    const { harness, task } = welcome();
    const replayed = replayEventLog(harness.events);
    expect(replayed.failures).toEqual([]);
    expect(replayed.state.tasks[task.id]).toEqual(task);
  });

  test('is refused a second time', () => {
    const { harness } = welcome();
    expect(() => harness.send({ type: 'onboarding.welcome', body: BODY })).toThrow(
      'The welcome task is already there.'
    );
    expect(Object.keys(harness.state.tasks)).toHaveLength(1);
  });

  test('needs a summary', () => {
    const harness = createHarness();
    expect(() => harness.send({ type: 'onboarding.welcome', body: '  ' })).toThrow(
      'The welcome needs a summary.'
    );
    expect(selectWelcomeTask(harness.state.tasks)).toBeNull();
  });
});
