import { describe, expect, test } from 'bun:test';
import type { TaskStage } from '../../src/domain/types.ts';
import {
  isPlacementRulesValid,
  type PlacementMachine,
  parsePlacementRules,
  resolveMachineLoad,
  resolvePlacement,
  resolveProjectMachine,
  resolveRuleMachine,
} from '../../src/remote/placement.ts';

function machine(
  id: string,
  stages: TaskStage[],
  options: { capacity?: number | null; projects?: string[]; rules?: string[] } = {}
): PlacementMachine {
  return {
    id,
    name: id,
    state: {
      tasks: Object.fromEntries(stages.map((stage, index) => [`${id}-${index}`, { stage }])),
      projects: Object.fromEntries((options.projects ?? []).map((project) => [project, {}])),
      settings: {
        ...(options.capacity === undefined ? {} : { taskCapacity: options.capacity }),
        ...(options.rules ? { placementRules: options.rules } : {}),
      },
    },
  };
}

describe('machine load', () => {
  test('counts open tasks only and marks a machine at its capacity as full', () => {
    expect(
      resolveMachineLoad(machine('a', ['building', 'merged', 'done', 'cancelled'], { capacity: 1 }))
    ).toEqual({
      id: 'a',
      name: 'a',
      open: 1,
      capacity: 1,
      full: true,
    });
    expect(resolveMachineLoad(machine('b', ['building']))).toMatchObject({ capacity: null, full: false });
  });
});

describe('placement', () => {
  test('a project goes to the machine that holds it, however busy', () => {
    const machines = [
      machine('a', []),
      machine('b', ['building', 'building'], { capacity: 1, projects: ['p'] }),
    ];
    expect(resolveProjectMachine(machines, 'p')).toBe('b');
    expect(resolveProjectMachine(machines, 'q')).toBeNull();
    expect(resolvePlacement(machines, 'p')).toBe('b');
  });

  test('without a project, the machine with the most room takes it', () => {
    const machines = [
      machine('a', ['building', 'building'], { capacity: 4 }),
      machine('b', ['building'], { capacity: 4 }),
    ];
    expect(resolvePlacement(machines, null)).toBe('b');
    expect(resolvePlacement(machines, 'unknown')).toBe('b');
  });

  test('a full machine is passed over, and a machine with no limit has room', () => {
    expect(
      resolvePlacement(
        [machine('a', ['building'], { capacity: 1 }), machine('b', ['building'], { capacity: 8 })],
        null
      )
    ).toBe('b');
    expect(
      resolvePlacement(
        [machine('a', ['building'], { capacity: 8 }), machine('b', ['building', 'building'])],
        null
      )
    ).toBe('b');
  });

  test('two machines with no limit share by open tasks, and when all are full the least loaded still takes it', () => {
    expect(resolvePlacement([machine('a', ['building', 'building']), machine('b', ['building'])], null)).toBe(
      'b'
    );
    expect(
      resolvePlacement(
        [
          machine('a', ['building', 'building'], { capacity: 1 }),
          machine('b', ['building'], { capacity: 1 }),
        ],
        null
      )
    ).toBe('b');
  });

  test('no machine, no placement', () => {
    expect(resolvePlacement([], null)).toBeNull();
  });
});

describe('placement rules', () => {
  const studio = machine('studio', [], { rules: ['iOS', 'simulator'] });
  const server = machine('server', ['building', 'building'], {
    rules: ['bench mark', 'C++'],
    projects: ['p'],
  });

  test('a request naming a machine’s word or phrase goes there, as a whole word and in any case', () => {
    expect(resolveRuleMachine([studio, server], 'Run the iOS tests')).toEqual({ id: 'studio', rule: 'iOS' });
    expect(resolveRuleMachine([studio, server], 'a Bench Mark run')).toEqual({
      id: 'server',
      rule: 'bench mark',
    });
    expect(resolveRuleMachine([studio, server], 'build with c++ flags')).toEqual({
      id: 'server',
      rule: 'C++',
    });
    expect(resolveRuleMachine([studio, server], 'a kiosk with simulators')).toBeNull();
    expect(resolveRuleMachine([machine('bare', [])], 'iOS')).toBeNull();
  });

  test('a project still wins, a rule beats room, and room decides the rest', () => {
    expect(resolvePlacement([studio, server], 'p', 'iOS work')).toBe('server');
    expect(resolvePlacement([server, studio], null, 'benchmark')).toBe('studio');
    expect(resolvePlacement([studio, server], null, 'a bench mark')).toBe('server');
  });

  test('rules are read from comma-separated text, trimmed and without repeats, and checked for size', () => {
    expect(parsePlacementRules(' iOS, simulator ,, iOS ')).toEqual(['iOS', 'simulator']);
    expect(isPlacementRulesValid(['iOS'])).toBe(true);
    expect(isPlacementRulesValid([''])).toBe(false);
  });
});
