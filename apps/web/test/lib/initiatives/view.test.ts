import { describe, expect, it } from 'bun:test';
import { resolveInitiativeSheet } from '@shinsa/core';
import {
  describePhaseProgress,
  describeSheetSummary,
  isInitiativeRoute,
  isInitiativesNavShown,
  isPhaseDone,
  listInitiativeRows,
  listInitiativeSections,
  resolveCanonicalInitiativePath,
  selectInitiativeView,
} from '@/lib/initiatives/view.ts';
import { createGate, createInitiative, createShinsaState, createTask, NOW } from '../../support/state.ts';

const PHASES = [
  { id: 'p1', name: 'Dock host' },
  { id: 'p2', name: 'Studio chat' },
];

function createSplitState() {
  return createShinsaState({
    initiatives: [
      createInitiative({ id: 'split', name: 'Chat split', phases: PHASES }),
      createInitiative({ id: 'empty', name: 'Billing', createdAt: NOW }),
    ],
    tasks: [
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
    expect(rows.map((row) => row.initiative.id)).toEqual(['split', 'empty']);
    expect(rows[0]).toMatchObject({ total: 5, open: 3, shipped: 1, dropped: 1 });
    expect(rows[0]?.summary).toBe('5 tasks · 3 open · 1 shipped');
    expect(rows[1]?.summary).toBe('No tasks yet');
  });
});

describe('selectInitiativeView', () => {
  it('finds the initiative by its id or its name, and nothing for an unknown one', () => {
    const state = createSplitState();
    expect(selectInitiativeView(state, 'split', NOW)?.initiative.name).toBe('Chat split');
    expect(selectInitiativeView(state, 'chat split', NOW)?.initiative.id).toBe('split');
    expect(selectInitiativeView(state, 'nothing', NOW)).toBeNull();
  });
});

describe('resolveCanonicalInitiativePath', () => {
  it('replaces a name in the address with the id and keeps the query', () => {
    const initiative = createInitiative({ id: 'split', name: 'Chat split' });
    expect(resolveCanonicalInitiativePath(initiative, 'Chat split', '?x=1')).toBe('/initiatives/split?x=1');
    expect(resolveCanonicalInitiativePath(initiative, 'split', '')).toBeNull();
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

describe('the navigation entry', () => {
  it('shows once an initiative exists, and always on the initiative pages', () => {
    const none = createShinsaState({});
    expect(isInitiativesNavShown(none, { name: 'home' })).toBe(false);
    expect(isInitiativesNavShown(none, { name: 'initiatives' })).toBe(true);
    expect(isInitiativesNavShown(createSplitState(), { name: 'home' })).toBe(true);
    expect(isInitiativeRoute({ name: 'initiative', reference: 'x' })).toBe(true);
    expect(isInitiativeRoute({ name: 'tasks' })).toBe(false);
  });
});
