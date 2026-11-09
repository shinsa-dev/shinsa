import { describe, expect, it } from 'bun:test';
import { describePhaseProgress, resolveInitiativeSheet } from '@shinsa/core';
import {
  describeSheetSummary,
  isPhaseDone,
  listInitiativeRows,
  listInitiativeSections,
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
    expect(isPhaseDone(first)).toBe(false);
    expect(isPhaseDone({ phase: null, total: 2, shipped: 1, dropped: 1 })).toBe(true);
    expect(isPhaseDone({ phase: null, total: 0, shipped: 0, dropped: 0 })).toBe(false);
  });

  it('sums up the whole initiative, or says how to start one', () => {
    expect(describeSheetSummary(sheet)).toBe('5 tasks · 3 open · 1 shipped');
    const empty = resolveInitiativeSheet(state, 'empty', NOW);
    if (!empty) throw new Error('No sheet');
    expect(describeSheetSummary(empty)).toStartWith('No tasks yet.');
  });

  it('lists the sections in reading order with their counts', () => {
    expect(listInitiativeSections(sheet).map((section) => [section.key, section.count])).toEqual([
      ['needsYou', 1],
      ['now', 0],
      ['next', 2],
      ['shipped', 1],
      ['dropped', 1],
      ['decisions', 0],
    ]);
  });
});
