import { describe, expect, it } from 'bun:test';
import type { Plan } from '@shinsa/core';
import {
  ACTOR_LABEL,
  listActivityDetail,
  listActivityNewestFirst,
  resolveActivityActor,
  resolveActivityGlyph,
  resolveOverviewSummary,
} from '@/lib/overview/activity.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const PLAN: Plan = {
  version: 1,
  body: '',
  proposedAt: 0,
  document: {
    goal: 'Let exports retry only the failed chunk.',
    phases: [],
    behaviour: [],
    approach: '',
    files: [],
    outOfScope: [],
    verification: [],
    questions: [],
  },
};

const REPORT = { headline: 'Retries only the failed chunk', sections: [], checks: [], judgementCalls: [] };

describe('resolveOverviewSummary', () => {
  it('prefers the work report headline, then the summary, then the plan goal', () => {
    expect(
      resolveOverviewSummary(createTask({ id: 'a', report: REPORT, summary: 'Summary', plan: PLAN }))
    ).toBe('Retries only the failed chunk');
    expect(resolveOverviewSummary(createTask({ id: 'b', summary: 'Summary', plan: PLAN }))).toBe('Summary');
    expect(resolveOverviewSummary(createTask({ id: 'c', plan: PLAN }))).toBe(
      'Let exports retry only the failed chunk.'
    );
  });

  it('has no summary before there is anything to say', () => {
    expect(resolveOverviewSummary(createTask({ id: 'a' }))).toBeNull();
    expect(resolveOverviewSummary(createTask({ id: 'b', plan: { ...PLAN, document: null } }))).toBeNull();
  });
});

describe('listActivityNewestFirst', () => {
  it('lists the newest entry first and keeps the log’s order between entries of the same moment', () => {
    const entry = (at: number, text: string) => ({
      at,
      kind: 'note' as const,
      actor: 'shinsa' as const,
      text,
      detail: null,
      evidenceId: null,
    });
    const task = createTask({
      id: 'a',
      activity: [entry(1, 'Asked'), entry(3, 'Planned'), entry(3, 'Building started'), entry(2, 'Late note')],
    });
    expect(listActivityNewestFirst(task).map((item) => item.text)).toEqual([
      'Building started',
      'Planned',
      'Late note',
      'Asked',
    ]);
    expect(task.activity.map((item) => item.text)).toEqual([
      'Asked',
      'Planned',
      'Building started',
      'Late note',
    ]);
  });
});

describe('listActivityDetail', () => {
  it('splits a check entry’s detail into its lines, and keeps every other detail whole', () => {
    const entry = { at: 1, actor: 'shinsa', text: '1 of 2 checks failed', evidenceId: null } as const;
    expect(
      listActivityDetail({
        ...entry,
        kind: 'check',
        detail: 'Types: `tsc` failed\n\nLint: passed when re-run alone',
      })
    ).toEqual(['Types: `tsc` failed', 'Lint: passed when re-run alone']);
    expect(listActivityDetail({ ...entry, kind: 'note', detail: 'One\nTwo' })).toEqual(['One\nTwo']);
    expect(listActivityDetail({ ...entry, kind: 'check', detail: null })).toEqual([]);
    expect(resolveActivityGlyph({ ...entry, kind: 'check', detail: null })).toEqual({
      icon: 'IconTestTube',
      tone: 'blue',
    });
  });
});

describe('activity marks', () => {
  it('shows failures in red and names every actor', () => {
    const entry = { at: 1, actor: 'shinsa', text: 'Stopped', detail: null, evidenceId: null } as const;
    expect(resolveActivityGlyph({ ...entry, kind: 'failure' })).toEqual({
      icon: 'IconExclamationCircle',
      tone: 'red',
    });
    expect(resolveActivityGlyph({ ...entry, kind: 'failure', gateType: 'failure' })).toEqual({
      icon: 'IconExclamationCircle',
      tone: 'red',
    });
    expect(Object.values(ACTOR_LABEL)).toEqual(['You', 'Agent', 'Shinsa']);
    const asked = {
      at: 1,
      actor: 'you' as const,
      kind: 'asked' as const,
      text: 'Asked',
      detail: null,
      evidenceId: null,
    };
    const state = createShinsaState({});
    expect(resolveActivityActor(state, asked)).toEqual({ label: 'You', taskId: null });
    expect(resolveActivityActor(state, { ...asked, onBehalf: true })).toEqual({
      label: 'Shinsa (on your behalf)',
      taskId: null,
    });
  });

  it('names the person a task was handed to by their GitHub login', () => {
    const entry = {
      at: 1,
      actor: 'you' as const,
      kind: 'decision' as const,
      text: 'Approved the plan',
      detail: null,
      evidenceId: null,
      byGuest: 'kai',
    };
    expect(resolveActivityActor(createShinsaState({}), entry)).toEqual({ label: '@kai', taskId: null });
  });

  it('names the task whose agent acted on your behalf, and links to it', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'a1', handle: 'SW-142' }),
        createTask({ id: 'a2', handle: null, title: 'Tidy the logs' }),
      ],
    });
    const entry = {
      at: 1,
      actor: 'you' as const,
      kind: 'decision' as const,
      text: 'Completed the task',
      detail: null,
      evidenceId: null,
      onBehalf: true,
    };
    expect(resolveActivityActor(state, { ...entry, byTask: 'a1' })).toEqual({
      label: 'SW-142 agent (on your behalf)',
      taskId: 'a1',
    });
    expect(resolveActivityActor(state, { ...entry, byTask: 'a2' })).toEqual({
      label: '“Tidy the logs” agent (on your behalf)',
      taskId: 'a2',
    });
    expect(resolveActivityActor(state, { ...entry, byTask: 'gone' }).label).toBe('Shinsa (on your behalf)');
  });

  it('names the owner instead of you when someone else reads their shared task', () => {
    const state = createShinsaState({ tasks: [createTask({ id: 'a1', handle: 'SW-142' })] });
    const entry = {
      at: 1,
      actor: 'you' as const,
      kind: 'asked' as const,
      text: 'Asked for this',
      detail: null,
      evidenceId: null,
    };
    expect(resolveActivityActor(state, entry, 'Kai')).toEqual({ label: 'Kai', taskId: null });
    expect(resolveActivityActor(state, entry, 'The owner').label).toBe('The owner');
    expect(resolveActivityActor(state, { ...entry, actor: 'agent' }, 'Kai').label).toBe('Agent');
    expect(resolveActivityActor(state, { ...entry, onBehalf: true }, 'Kai').label).toBe(
      'Shinsa (on Kai’s behalf)'
    );
    expect(resolveActivityActor(state, { ...entry, onBehalf: true, byTask: 'a1' }, 'The owner')).toEqual({
      label: 'SW-142 agent (on the owner’s behalf)',
      taskId: 'a1',
    });
  });

  it('marks a setup problem and a sign-in with the same tile as the task’s status', () => {
    const entry = {
      at: 1,
      actor: 'shinsa',
      kind: 'failure',
      text: 'x',
      detail: null,
      evidenceId: null,
    } as const;
    expect(resolveActivityGlyph({ ...entry, gateType: 'sign_in' })).toEqual({
      icon: 'IconUserKey',
      tone: 'orange',
    });
    expect(resolveActivityGlyph({ ...entry, gateType: 'configuration' })).toEqual({
      icon: 'IconToolbox',
      tone: 'orange',
    });
  });
});
