import { describe, expect, it } from 'bun:test';
import { INITIATIVE_LIMITS } from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import {
  closeInitiativeDialog,
  createInitiativeDraft,
  createPhaseDraft,
  movePhase,
  openInitiativeDialog,
  resolveDraftProblem,
  serializeInitiativeDraft,
  useInitiativeDialog,
  writeInitiative,
} from '@/lib/initiatives/draft.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createInitiative } from '../../support/state.ts';

const SPLIT = createInitiative({
  id: 'split',
  name: 'Chat split',
  description: 'Small pull requests',
  phases: [
    { id: 'p1', name: 'Dock' },
    { id: 'p2', name: 'Studio' },
  ],
});

describe('the initiative dialog', () => {
  it('opens on the initiative to edit, and closes', () => {
    const { result } = renderHook(() => useInitiativeDialog());
    expect(result.current).toBeNull();
    act(() => openInitiativeDialog('split'));
    expect(result.current).toEqual({ initiativeId: 'split' });
    act(() => closeInitiativeDialog());
    expect(result.current).toBeNull();
  });
});

describe('the draft', () => {
  it('starts from the initiative with its phases keyed by id', () => {
    expect(createInitiativeDraft(SPLIT).phases).toEqual([
      { key: 'p1', id: 'p1', name: 'Dock' },
      { key: 'p2', id: 'p2', name: 'Studio' },
    ]);
  });

  it('gives each new phase its own key and no id', () => {
    const first = createPhaseDraft('A');
    const second = createPhaseDraft();
    expect(first.id).toBeNull();
    expect(second.name).toBe('');
    expect(first.key).not.toBe(second.key);
  });

  it('moves a phase up or down, and leaves the order at either end', () => {
    const phases = createInitiativeDraft(SPLIT).phases;
    expect(movePhase(phases, 'p2', -1).map((phase) => phase.id)).toEqual(['p2', 'p1']);
    expect(movePhase(phases, 'p1', 1).map((phase) => phase.id)).toEqual(['p2', 'p1']);
    expect(movePhase(phases, 'p1', -1).map((phase) => phase.id)).toEqual(['p1', 'p2']);
    expect(movePhase(phases, 'p2', 1).map((phase) => phase.id)).toEqual(['p1', 'p2']);
    expect(movePhase(phases, 'nope', 1).map((phase) => phase.id)).toEqual(['p1', 'p2']);
  });

  it('names the first problem it finds, and none for a good draft', () => {
    const good = createInitiativeDraft(SPLIT);
    expect(resolveDraftProblem(good)).toBeNull();
    expect(resolveDraftProblem({ ...good, name: '  ' })).toBe('Name the initiative.');
    expect(resolveDraftProblem({ ...good, name: 'x'.repeat(INITIATIVE_LIMITS.name + 1) })).toContain(
      'at most'
    );
    expect(
      resolveDraftProblem({ ...good, description: 'x'.repeat(INITIATIVE_LIMITS.description + 1) })
    ).toContain('description');
    const many = Array.from({ length: INITIATIVE_LIMITS.phases + 1 }, (_, index) =>
      createPhaseDraft(`P${index}`)
    );
    expect(resolveDraftProblem({ ...good, phases: many })).toContain('phases');
    expect(resolveDraftProblem({ ...good, phases: [createPhaseDraft(' ')] })).toBe(
      'Name every phase, or remove the empty one.'
    );
    expect(
      resolveDraftProblem({
        ...good,
        phases: [createPhaseDraft('x'.repeat(INITIATIVE_LIMITS.phaseName + 1))],
      })
    ).toContain('phase');
    expect(
      resolveDraftProblem({ ...good, phases: [createPhaseDraft('Dock'), createPhaseDraft('dock')] })
    ).toBe('Two phases are named dock. Give each its own name.');
  });

  it('sends the cleaned draft, keeping the ids of phases it had', async () => {
    const draft = createInitiativeDraft(SPLIT);
    const edited = {
      ...draft,
      name: '  Chat   split ',
      phases: [...draft.phases, createPhaseDraft(' Builder ')],
    };
    expect(serializeInitiativeDraft(edited, SPLIT)).toEqual({
      type: 'initiative.write',
      initiativeId: 'split',
      name: 'Chat split',
      description: 'Small pull requests',
      phases: [
        { id: 'p1', name: 'Dock' },
        { id: 'p2', name: 'Studio' },
        { id: null, name: 'Builder' },
      ],
    });
    const spies = spyOnCommands();
    await writeInitiative(edited, SPLIT);
    expect(spies.sent.mock.calls.map((call) => call[1])).toEqual(['Saved the initiative “Chat split”.']);
  });
});
