import { describe, expect, it } from 'bun:test';
import type { Task, TriageDecisions } from '@shinsa/core';
import { resolveTriageWhy, type TriageFact } from '@/lib/tasks/triage.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const DECIDED: TriageDecisions = {
  shape: { value: 'answer', why: 'It asks how something works.' },
  start: { value: [], why: 'Nothing it touches is in flight.' },
  priority: { value: 'normal', why: 'Nothing is waiting on it.' },
};

const FACTS: TriageFact[] = ['start', 'priority'];

function whyOf(
  overrides: Partial<Task>,
  decisions: TriageDecisions | null = DECIDED,
  owner: string | null = null
) {
  const base = createTask({ id: 'base', title: 'Fix the schema' });
  const other = createTask({ id: 'other', title: 'Add the column' });
  const task = createTask({ id: 't', pipeline: ['answer'], triageDecisions: decisions, ...overrides });
  const state = createShinsaState({ tasks: [task, base, other] });
  return FACTS.map((fact) => resolveTriageWhy(state, task, fact, owner));
}

describe('resolveTriageWhy', () => {
  it('has nothing to say before triage decided anything', () => {
    expect(whyOf({}, null)).toEqual([null, null]);
    expect(whyOf({}, { shape: null, start: null, priority: null })).toEqual([null, null]);
  });

  it('gives Shinsa’s reason for each fact it decided', () => {
    expect(whyOf({})).toEqual([
      'Shinsa chose this: Nothing it touches is in flight.',
      'Shinsa chose this: Nothing is waiting on it.',
    ]);
  });

  it('keeps the start Shinsa’s choice while the task waits on the same tasks in any order', () => {
    const [start] = whyOf(
      { waitsOn: ['base', 'other'] },
      { shape: null, start: { value: ['other', 'base'], why: 'Both touch the schema.' }, priority: null }
    );
    expect(start).toBe('Shinsa chose this: Both touch the schema.');
  });

  it('names what Shinsa had chosen once you changed a fact', () => {
    expect(whyOf({ waitsOn: ['base'], priority: 'urgent' })).toEqual([
      'You changed this. Shinsa chose “starts now”: Nothing it touches is in flight.',
      'You changed this. Shinsa chose “normal priority”: Nothing is waiting on it.',
    ]);
    const [start, priority] = whyOf(
      { waitsOn: [], priority: 'normal' },
      {
        shape: null,
        start: { value: ['other', 'base'], why: 'Both touch the schema.' },
        priority: { value: 'urgent', why: 'It blocks a release.' },
      }
    );
    expect(start).toBe('You changed this. Shinsa chose “starts after 2 tasks”: Both touch the schema.');
    expect(priority).toBe('You changed this. Shinsa chose “urgent”: It blocks a release.');
    const [single] = whyOf(
      {},
      { shape: null, start: { value: ['base'], why: 'It needs the schema.' }, priority: null }
    );
    expect(single).toBe(
      'You changed this. Shinsa chose “starts after “Fix the schema””: It needs the schema.'
    );
  });

  it('names the owner who changed a fact to anyone else looking', () => {
    expect(whyOf({ waitsOn: ['base'], priority: 'urgent' }, DECIDED, 'Kai')).toEqual([
      'Kai changed this. Shinsa chose “starts now”: Nothing it touches is in flight.',
      'Kai changed this. Shinsa chose “normal priority”: Nothing is waiting on it.',
    ]);
    expect(whyOf({}, DECIDED, 'Kai')).toEqual([
      'Shinsa chose this: Nothing it touches is in flight.',
      'Shinsa chose this: Nothing is waiting on it.',
    ]);
  });
});
