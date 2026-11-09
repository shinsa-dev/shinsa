import { describe, expect, it } from 'bun:test';
import { describePhaseProgress, resolveInitiativeSheet } from '@shinsa/core';
import {
  listInitiativeActivity,
  listInitiativeRows,
  listInitiativeTaskSections,
} from '@/lib/initiatives/view.ts';
import { createGate, createInitiative, createShinsaState, createTask, NOW } from '../../support/state.ts';

const PHASES = [
  { id: 'p1', name: 'Dock host' },
  { id: 'p2', name: 'Studio chat' },
];

function createSplitState() {
  return createShinsaState({
    initiatives: [
      createInitiative({ id: 'split', name: 'Chat split', phases: PHASES, leadTaskId: 'lead-split' }),
      createInitiative({ id: 'empty', name: 'Billing', createdAt: NOW, leadTaskId: 'lead-empty' }),
      createInitiative({ id: 'done', name: 'Docs', leadTaskId: 'lead-done' }),
    ],
    tasks: [
      createTask({ id: 'lead-split', pipeline: ['lead'], stage: 'leading', initiativeId: 'split' }),
      createTask({ id: 'lead-empty', pipeline: ['lead'], stage: 'leading', initiativeId: 'empty' }),
      createTask({ id: 'lead-done', pipeline: ['lead'], stage: 'done', closedAt: NOW, initiativeId: 'done' }),
      createTask({
        id: 'merged',
        stage: 'merged',
        closedAt: NOW,
        initiativeId: 'split',
        initiativePhaseId: 'p1',
      }),
      createTask({ id: 'review', stage: 'awaiting_review', initiativeId: 'split', initiativePhaseId: 'p1' }),
      createTask({
        id: 'waiting',
        stage: 'waiting_on_tasks',
        initiativeId: 'split',
        initiativePhaseId: 'p2',
      }),
      createTask({ id: 'loose', stage: 'waiting_on_tasks', initiativeId: 'split' }),
      createTask({
        id: 'dropped',
        stage: 'cancelled',
        closedAt: NOW,
        initiativeId: 'split',
        initiativePhaseId: 'p2',
      }),
      createTask({ id: 'outside' }),
    ],
    gates: [createGate({ id: 'g', taskId: 'review', type: 'review' })],
  });
}

describe('listInitiativeRows', () => {
  it('counts each initiative’s open, shipped and dropped tasks in creation order', () => {
    const rows = listInitiativeRows(createSplitState());
    expect(rows.map((row) => [row.initiative.id, row.lead.id])).toEqual([
      ['split', 'lead-split'],
      ['empty', 'lead-empty'],
    ]);
    expect(rows[0]).toMatchObject({ total: 5, open: 3, shipped: 1, dropped: 1 });
    expect(rows[0]?.summary).toBe('5 tasks · 3 open · 1 shipped');
    expect(rows[1]?.summary).toBe('No tasks yet');
  });
});

describe('the sheet', () => {
  const state = createSplitState();
  const sheet = resolveInitiativeSheet(state, 'split', NOW);
  if (!sheet) throw new Error('No sheet');

  it('says how far each phase is, and when one is done', () => {
    const [first, second, none] = sheet.progress;
    if (!(first && second && none)) throw new Error('Missing phases');
    expect(describePhaseProgress(first)).toEqual({ name: 'Dock host', detail: '1 of 2 shipped' });
    expect(describePhaseProgress(second)).toEqual({
      name: 'Studio chat',
      detail: '0 of 1 shipped · 1 dropped',
    });
    expect(describePhaseProgress(none)).toEqual({ name: 'No phase', detail: '0 of 1 shipped' });
    expect(describePhaseProgress({ phase: null, total: 0, shipped: 0, dropped: 0 }).detail).toBe(
      'No tasks yet'
    );
  });

  it('groups the tasks as All tasks does, with what comes next by phase after In progress', () => {
    expect(
      listInitiativeTaskSections(state, sheet).map((section) => [
        section.group.title,
        section.entries.map((entry) => entry.task.id),
      ])
    ).toEqual([
      ['Changes to review', ['review']],
      ['Up next: Studio chat', ['waiting']],
      ['Up next: No phase', ['loose']],
      ['Done', ['merged']],
      ['Cancelled', ['dropped']],
    ]);
  });

  it('says only Up next when the initiative has no phases', () => {
    const flat = createShinsaState({
      initiatives: [createInitiative({ id: 'flat', leadTaskId: 'lead' })],
      tasks: [
        createTask({ id: 'lead', pipeline: ['lead'], stage: 'leading', initiativeId: 'flat' }),
        createTask({ id: 'working', stage: 'building', initiativeId: 'flat' }),
        createTask({ id: 'later', stage: 'waiting_on_tasks', initiativeId: 'flat' }),
      ],
    });
    const flatSheet = resolveInitiativeSheet(flat, 'flat', NOW);
    if (!flatSheet) throw new Error('No sheet');
    expect(listInitiativeTaskSections(flat, flatSheet).map((section) => section.group.title)).toEqual([
      'In progress',
      'Up next',
    ]);
  });

  it('turns approved plans and judgement calls into activity entries', () => {
    const named = createShinsaState({ tasks: [createTask({ id: 'a', handle: 'SW-1' })] });
    const entries = listInitiativeActivity(named, {
      ...sheet,
      decisions: [
        { taskId: 'a', kind: 'plan', title: 'Dock', text: 'Rewrite the dock', at: 2 },
        { taskId: 'gone', kind: 'call', title: 'Keep the API', text: 'Kept it', at: 1 },
      ],
    });
    expect(entries.map((entry) => [entry.actor, entry.kind, entry.text, entry.detail])).toEqual([
      ['you', 'decision', 'Approved the plan of SW-1', 'Rewrite the dock'],
      ['agent', 'shape', '“Keep the API” chose: Keep the API', 'Kept it'],
    ]);
  });
});
