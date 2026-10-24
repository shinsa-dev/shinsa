import { describe, expect, it } from 'bun:test';
import type { Spec } from '@shinsa/core';
import {
  ACTOR_LABEL,
  resolveActivityActor,
  resolveActivityGlyph,
  resolveOverviewSummary,
} from '@/lib/overview/activity.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const SPEC: Spec = {
  version: 1,
  body: '',
  proposedAt: 0,
  document: {
    goal: 'Let exports retry only the failed chunk.',
    plan: [],
    behaviour: [],
    approach: '',
    files: [],
    outOfScope: [],
    verification: [],
    questions: [],
  },
};

const REPORT = { headline: 'Retries only the failed chunk', phases: [], checks: [], decisions: [] };

describe('resolveOverviewSummary', () => {
  it('prefers the work report headline, then the summary, then the spec goal', () => {
    expect(
      resolveOverviewSummary(createTask({ id: 'a', report: REPORT, summary: 'Summary', spec: SPEC }))
    ).toBe('Retries only the failed chunk');
    expect(resolveOverviewSummary(createTask({ id: 'b', summary: 'Summary', spec: SPEC }))).toBe('Summary');
    expect(resolveOverviewSummary(createTask({ id: 'c', spec: SPEC }))).toBe(
      'Let exports retry only the failed chunk.'
    );
  });

  it('has no summary before there is anything to say', () => {
    expect(resolveOverviewSummary(createTask({ id: 'a' }))).toBeNull();
    expect(resolveOverviewSummary(createTask({ id: 'b', spec: { ...SPEC, document: null } }))).toBeNull();
  });
});

describe('activity marks', () => {
  it('shows failures in red and names every actor', () => {
    const entry = { at: 1, actor: 'shinsa', text: 'Stopped', detail: null, evidenceId: null } as const;
    expect(resolveActivityGlyph({ ...entry, kind: 'failure' })).toEqual({
      icon: 'IconExclamationCircle',
      tone: 'red',
    });
    expect(resolveActivityGlyph({ ...entry, kind: 'failure', purpose: 'failure' })).toEqual({
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

  it('marks a setup problem and a sign-in with the same tile as the task’s status', () => {
    const entry = {
      at: 1,
      actor: 'shinsa',
      kind: 'failure',
      text: 'x',
      detail: null,
      evidenceId: null,
    } as const;
    expect(resolveActivityGlyph({ ...entry, purpose: 'sign_in' })).toEqual({
      icon: 'IconUserKey',
      tone: 'orange',
    });
    expect(resolveActivityGlyph({ ...entry, purpose: 'configuration' })).toEqual({
      icon: 'IconToolbox',
      tone: 'orange',
    });
  });
});
