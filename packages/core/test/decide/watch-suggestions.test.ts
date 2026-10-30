import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  type CommandOf,
  createState,
  type DomainError,
  listOpenWatchSuggestions,
  SCHEDULE_LIMITS,
  type WatchSuggestion,
} from '../../src/index.ts';
import { createHarness, createTask, type Harness, registerRepo } from '../harness.ts';

const FEEDBACK = { server: 'slack', data: 'Bug reports in #feedback' };

function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return { code: (error as DomainError).code, message: (error as Error).message };
  }
  throw new Error('expected a refusal');
}

function createProject() {
  const harness = createHarness();
  const repoId = registerRepo(harness);
  const projectId = harness.state.repos[repoId]?.projectId ?? '';
  harness.send({ type: 'watch_source.write', projectId, ...FEEDBACK, repoIds: [] });
  return { harness, projectId };
}

function record(harness: Harness, input: Partial<CommandOf<'watch_suggestion.record'>> = {}) {
  const projectId = Object.keys(harness.state.projects)[0] ?? '';
  return harness.send({
    type: 'watch_suggestion.record',
    projectId,
    server: 'slack',
    name: 'Feedback bugs',
    text: 'File a task for each new bug in #feedback.',
    timeZone: 'Europe/Berlin',
    ...input,
  });
}

function suggestions(harness: Harness): WatchSuggestion[] {
  return Object.values(harness.state.watchSuggestions);
}

function only(harness: Harness) {
  const [first] = suggestions(harness);
  if (!first) throw new Error('no suggestion');
  return first;
}

function requestSchedule(harness: Harness, taskId: string, input: Partial<CommandOf<'agent.set_schedule'>> = {}) {
  return harness.send({
    type: 'agent.set_schedule',
    runId: harness.activeRun(taskId).id,
    scheduleId: null,
    name: 'Feedback bugs',
    text: 'File a task for each new bug in #feedback.',
    trigger: { kind: 'interval', everyMinutes: 60 },
    target: null,
    source: 'slack',
    enabled: null,
    maxRuns: null,
    timeZone: 'UTC',
    ...input,
  });
}

describe('a watch suggested for a new integration', () => {
  test('is recorded hourly, for the human to accept or dismiss, and starts nothing', () => {
    const { harness, projectId } = createProject();
    record(harness);
    expect(only(harness)).toMatchObject({
      projectId,
      server: 'slack',
      name: 'Feedback bugs',
      text: 'File a task for each new bug in #feedback.',
      trigger: { kind: 'interval', everyMinutes: SCHEDULE_LIMITS.suggestedEveryMinutes },
      timeZone: 'Europe/Berlin',
      origin: { kind: 'source' },
      status: 'open',
      scheduleId: null,
      decidedAt: null,
    });
    expect(harness.state.schedules).toEqual({});
    expect(listOpenWatchSuggestions(harness.state, projectId)).toHaveLength(1);
    expect(listOpenWatchSuggestions(harness.state, 'another')).toHaveLength(0);
  });

  test('falls back to plain wording and UTC when the writer gives none or a time zone that is not one', () => {
    const { harness } = createProject();
    record(harness, { name: null, text: '  ', timeZone: 'Mars/Olympus' });
    expect(only(harness)).toMatchObject({
      name: 'Watch slack',
      text: 'File a task for each new report in slack.',
      timeZone: 'UTC',
    });
  });

  test('is offered once per integration, never for one already watched or no longer used', () => {
    const { harness, projectId } = createProject();
    record(harness, { server: 'maple' });
    expect(suggestions(harness)).toHaveLength(0);
    record(harness);
    harness.send({ type: 'watch_suggestion.dismiss', suggestionId: only(harness).id });
    record(harness);
    expect(suggestions(harness)).toHaveLength(1);
    harness.send({ type: 'watch_source.write', projectId, server: 'maple', data: 'Errors', repoIds: [] });
    harness.send({
      type: 'schedule.write',
      scheduleId: null,
      name: 'Errors',
      text: 'Errors in Maple.',
      trigger: { kind: 'interval', everyMinutes: 30 },
      target: null,
      source: { projectId, server: 'maple' },
      enabled: null,
      maxRuns: null,
      timeZone: 'UTC',
    });
    record(harness, { server: 'maple' });
    expect(suggestions(harness)).toHaveLength(1);
  });

  test('accepting writes the watch as yours, with its home and its first read an hour later', () => {
    const { harness, projectId } = createProject();
    record(harness);
    const suggestion = only(harness);
    harness.send({ type: 'watch_suggestion.accept', suggestionId: suggestion.id });
    const [schedule] = Object.values(harness.state.schedules);
    expect(schedule).toMatchObject({
      name: 'Feedback bugs',
      text: 'File a task for each new bug in #feedback.',
      source: { projectId, server: 'slack' },
      createdBy: { kind: 'you' },
      enabled: true,
      nextRunAt: harness.now + 60 * 60_000,
    });
    const homeId = schedule?.target.kind === 'task' ? schedule.target.taskId : '';
    expect(harness.task(homeId).watchHome).toBe(true);
    expect(only(harness)).toMatchObject({
      status: 'accepted',
      scheduleId: schedule?.id,
      decidedAt: harness.now,
    });
  });

  test('only the human accepts it, once; dismissing it keeps it out of the way', () => {
    const { harness } = createProject();
    record(harness);
    const suggestionId = only(harness).id;
    const onBehalf = refusal(() =>
      harness.send({ type: 'watch_suggestion.accept', suggestionId }, { onBehalf: true, byTask: null })
    );
    expect(onBehalf.code).toBe('human_only');
    harness.send({ type: 'watch_suggestion.dismiss', suggestionId }, { onBehalf: true, byTask: null });
    expect(only(harness)).toMatchObject({ status: 'dismissed', decidedAt: harness.now });
    expect(harness.state.onBehalfActions.at(-1)?.summary).toBe(
      'Dismissed the suggested watch “Feedback bugs”'
    );
    const decided = refusal(() => harness.send({ type: 'watch_suggestion.accept', suggestionId }));
    expect(decided).toEqual({
      code: 'suggestion_decided',
      message: 'The suggested watch “Feedback bugs” was already dismissed.',
    });
    expect(refusal(() => harness.send({ type: 'watch_suggestion.dismiss', suggestionId: 'nope' })).code).toBe(
      'suggestion_not_found'
    );
  });

  test('is dropped while open when its integration or its project goes', () => {
    const { harness, projectId } = createProject();
    harness.send({ type: 'watch_source.write', projectId, server: 'maple', data: 'Errors', repoIds: [] });
    record(harness);
    record(harness, { server: 'maple' });
    harness.send({ type: 'watch_suggestion.dismiss', suggestionId: suggestions(harness)[1]?.id ?? '' });
    harness.send({ type: 'watch_source.remove', projectId, server: 'slack' });
    harness.send({ type: 'watch_source.remove', projectId, server: 'maple' });
    expect(suggestions(harness).map((suggestion) => suggestion.server)).toEqual(['maple']);
    harness.send({ type: 'project.remove', projectId });
    expect(suggestions(harness)).toEqual([]);
  });

  test('waits for room when the human already has as many open suggestions as Shinsa keeps', () => {
    const { harness, projectId } = createProject();
    for (let index = 0; index < SCHEDULE_LIMITS.openSuggestions; index += 1) {
      const server = `source-${index}`;
      harness.send({ type: 'watch_source.write', projectId, server, data: 'Reports', repoIds: [] });
      record(harness, { server });
    }
    record(harness);
    expect(suggestions(harness).some((suggestion) => suggestion.server === 'slack')).toBe(false);
    const taskId = createTask(harness);
    expect(refusal(() => requestSchedule(harness, taskId)).code).toBe('suggestion_limit');
  });
});

describe('a watch an agent sets', () => {
  test('becomes a suggestion from its task instead of a live watch, recorded in the task’s activity', () => {
    const { harness, projectId } = createProject();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    requestSchedule(harness, taskId, { maxRuns: 5, trigger: { kind: 'daily', time: '09:00', weekdays: [] } });
    expect(harness.state.schedules).toEqual({});
    expect(only(harness)).toMatchObject({
      projectId,
      server: 'slack',
      trigger: { kind: 'daily', time: '09:00', weekdays: [] },
      maxRuns: 5,
      origin: { kind: 'agent', taskId, runId },
      status: 'open',
    });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'agent',
      kind: 'suggestion',
      text: 'Suggested the watch “Feedback bugs”',
      detail: 'File a task for each new bug in #feedback.',
    });
    requestSchedule(harness, taskId);
    expect(suggestions(harness)).toHaveLength(1);
  });

  test('is checked like any watch before it is suggested', () => {
    const { harness } = createProject();
    const taskId = createTask(harness);
    expect(refusal(() => requestSchedule(harness, taskId, { source: 'maple' })).code).toBe('source_not_found');
    expect(refusal(() => requestSchedule(harness, taskId, { trigger: null })).code).toBe('schedule_invalid');
    expect(refusal(() => requestSchedule(harness, taskId, { target: { kind: 'task', taskId: null } })).code).toBe(
      'source_target'
    );
    expect(suggestions(harness)).toEqual([]);
  });

  test('one it set before suggestions existed still takes its changes, in place', () => {
    const { harness } = createProject();
    record(harness);
    harness.send({ type: 'watch_suggestion.accept', suggestionId: only(harness).id });
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    const [accepted] = Object.values(harness.state.schedules);
    if (!accepted) throw new Error('no schedule');
    harness.replay({
      type: 'schedule.written',
      schedule: { ...accepted, createdBy: { kind: 'agent', taskId, runId } },
    });
    requestSchedule(harness, taskId, { scheduleId: accepted.id, name: 'Renamed', source: null });
    expect(Object.values(harness.state.schedules)).toMatchObject([
      { id: accepted.id, name: 'Renamed', target: accepted.target },
    ]);
  });

  test('written on your behalf from a task becomes a suggestion too, and says so', () => {
    const { harness, projectId } = createProject();
    const taskId = createTask(harness);
    harness.send(
      {
        type: 'schedule.write',
        scheduleId: null,
        name: 'Feedback bugs',
        text: 'File a task for each new bug in #feedback.',
        trigger: { kind: 'interval', everyMinutes: 60 },
        target: null,
        source: { projectId, server: 'slack' },
        enabled: null,
        maxRuns: null,
        timeZone: 'UTC',
      },
      { onBehalf: true, byTask: taskId }
    );
    expect(harness.state.schedules).toEqual({});
    expect(only(harness).origin).toEqual({ kind: 'agent', taskId, runId: null });
    expect(harness.state.onBehalfActions.at(-1)?.summary).toBe('Suggested the watch “Feedback bugs”');
    harness.send(
      {
        type: 'schedule.write',
        scheduleId: null,
        name: null,
        text: 'Errors.',
        trigger: { kind: 'interval', everyMinutes: 60 },
        target: null,
        source: { projectId, server: 'slack' },
        enabled: null,
        maxRuns: null,
        timeZone: 'UTC',
      },
      { onBehalf: true, byTask: null }
    );
    expect(suggestions(harness)[1]?.origin).toEqual({ kind: 'agent', taskId: null, runId: null });
    expect(harness.state.onBehalfActions.at(-1)?.summary).toBe('Suggested the watch “Watch”');
  });
});

describe('the suggestion fold', () => {
  test('ignores a decision on a suggestion it does not have', () => {
    const state = createState();
    const next = applyEvent(state, {
      type: 'watch_suggestion.accepted',
      suggestionId: 'gone',
      scheduleId: 'schedule',
      seq: 1,
      at: 0,
    });
    expect(next.watchSuggestions).toEqual({});
  });
});
