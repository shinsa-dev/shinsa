import { describe, expect, test } from 'bun:test';
import type { Initiative, Task } from '@shinsa/core';
import { Effect } from 'effect';
import { findInitiativeSheet, listInitiativeViews } from '../../src/http/initiative-views.ts';
import { createGate, createStubEngine, createTask } from '../helpers/state.ts';

const BASE = 'http://127.0.0.1:5180';

const INITIATIVE: Initiative = {
  id: 'init-1',
  name: 'Chat split',
  description: '',
  phases: [],
  leadTaskId: 'lead',
  createdAt: 1,
  updatedAt: 1,
  report: {
    narrative: 'The dock is in review.',
    runId: 'run-1',
    at: 7,
  },
};

function createMember(overrides: Partial<Task>) {
  return createTask({ initiativeId: INITIATIVE.id, ...overrides });
}

function createState() {
  return createStubEngine((state) => {
    state.initiatives[INITIATIVE.id] = INITIATIVE;
    state.tasks.tools = createMember({
      id: 'tools',
      handle: 'SW-104',
      title: 'Account tools',
      stage: 'awaiting_plan',
    });
    state.gates['gate-tools'] = createGate({
      id: 'gate-tools',
      taskId: 'tools',
      type: 'plan',
      title: 'Approve the plan',
    });
    state.tasks.lead = createMember({
      id: 'lead',
      handle: 'SW-100',
      title: 'Lead the chat split',
      pipeline: ['lead'],
      stage: 'leading',
    });
    state.tasks.earlier = createMember({
      id: 'earlier',
      title: 'Lead it before',
      pipeline: ['lead'],
      stage: 'done',
    });
    state.tasks.dock = createMember({
      id: 'dock',
      handle: 'SW-101',
      title: 'Rewrite the dock',
      phaseReports: [
        {
          at: 5,
          summary: 'Did the phase.',
          spots: [],
          judgementCalls: [
            {
              title: 'Keep the hold',
              call: 'Open chats still hold the reload.',
              reason: 'Main did.',
              alternatives: [],
            },
          ],
        },
      ] as unknown as Task['phaseReports'],
    });
  }).state;
}

describe('initiative views', () => {
  test('names the lead by its handle', () => {
    expect(listInitiativeViews(createState(), BASE, 10)).toMatchObject([
      {
        id: 'init-1',
        lead: { id: 'lead', handle: 'SW-100', title: 'Lead the chat split' },
        members: 2,
        url: `${BASE}/tasks/SW-100`,
      },
    ]);
  });

  test('names no lead once it finished, and counts only the work', () => {
    const state = createState();
    state.tasks.lead = { ...state.tasks.lead, stage: 'done' } as Task;
    expect(listInitiativeViews(state, BASE, 10)).toMatchObject([
      { lead: null, members: 2, url: `${BASE}/tasks/SW-100` },
    ]);
    const orphan = createState();
    orphan.initiatives['init-1'] = { ...orphan.initiatives['init-1'], leadTaskId: null } as never;
    expect(listInitiativeViews(orphan, BASE, 10)).toMatchObject([{ url: BASE }]);
  });

  test('carries the lead’s last report without its run', async () => {
    const sheet = await Effect.runPromise(findInitiativeSheet(createState(), 'init', BASE, 10));
    expect(sheet.report).toEqual({
      narrative: 'The dock is in review.',
      at: 7,
    });
    const bare = createState();
    bare.initiatives['init-1'] = { ...INITIATIVE, report: null };
    expect((await Effect.runPromise(findInitiativeSheet(bare, 'init', BASE, 10))).report).toBeNull();
  });

  test('gives each decision its task as a reference, and each decision waiting for you its reason', async () => {
    const sheet = await Effect.runPromise(findInitiativeSheet(createState(), 'init', BASE, 10));
    expect(sheet.needsYou).toMatchObject([
      { task: { id: 'tools', handle: 'SW-104' }, reason: expect.any(String) },
    ]);
    expect(sheet.decisions).toEqual([
      {
        task: { id: 'dock', handle: 'SW-101', title: 'Rewrite the dock', status: expect.any(String) },
        kind: 'call',
        title: 'Keep the hold',
        text: 'Open chats still hold the reload.',
        at: 5,
      },
    ]);
  });
});
