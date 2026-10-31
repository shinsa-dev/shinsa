import { describe, expect, test } from 'bun:test';
import type { TaskStage } from '../../src/domain/types.ts';
import {
  hasPlacementPolicies,
  isPlacementPoliciesValid,
  listPlacementCandidates,
  NO_POLICY_MACHINE,
  type PlacementMachine,
  parsePlacementAnswer,
  parsePlacementQuestion,
  resolveMachineLoad,
  resolvePlacement,
  resolveProjectMachine,
  serializePlacementPrompt,
} from '../../src/remote/placement.ts';

function machine(
  id: string,
  stages: TaskStage[],
  options: { capacity?: number | null; projects?: string[]; policies?: string[] } = {}
): PlacementMachine {
  return {
    id,
    name: id,
    state: {
      tasks: Object.fromEntries(stages.map((stage, index) => [`${id}-${index}`, { stage }])),
      projects: Object.fromEntries((options.projects ?? []).map((project) => [project, {}])),
      settings: {
        ...(options.capacity === undefined ? {} : { taskCapacity: options.capacity }),
        ...(options.policies ? { placementPolicies: options.policies } : {}),
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

describe('placement policies', () => {
  const studio = machine('studio', ['building'], {
    policies: ['Run Xcode simulator tests on this machine.'],
  });
  const server = machine('server', ['building', 'building'], {
    capacity: 4,
    policies: ['Benchmarks and load tests always run here.'],
  });
  const bare = machine('bare', []);
  const question = {
    request: 'Run the iOS simulator tests',
    machines: listPlacementCandidates([studio, server, bare]),
  };

  test('a machine holds up to 20 policies of 1 to 240 characters, and any one turns the classifier on', () => {
    expect(isPlacementPoliciesValid(['Run iOS work here.'])).toBe(true);
    expect(isPlacementPoliciesValid([' '])).toBe(false);
    expect(isPlacementPoliciesValid(['x'.repeat(241)])).toBe(false);
    expect(isPlacementPoliciesValid(Array.from({ length: 21 }, (_, index) => `p${index}`))).toBe(false);
    expect(hasPlacementPolicies([studio, bare])).toBe(true);
    expect(hasPlacementPolicies([bare])).toBe(false);
  });

  test('the prompt lists every machine with its load and its policies in plain English, then the request', () => {
    expect(question.machines[1]).toEqual({
      id: 'server',
      name: 'server',
      policies: ['Benchmarks and load tests always run here.'],
      open: 2,
      capacity: 4,
    });
    const prompt = serializePlacementPrompt(question);
    expect(prompt).toContain(
      'Machine "studio" named studio (1 open tasks, no limit):\n  - Run Xcode simulator tests'
    );
    expect(prompt).toContain('Machine "server" named server (2 of 4 open tasks):');
    expect(prompt).toContain('Machine "bare" named bare (0 open tasks, no limit):\n  (no policies)');
    expect(prompt).toContain('The request:\nRun the iOS simulator tests');
  });

  test('the answer names one of the machines, with a short reason; "none" or anything else is no answer', () => {
    expect(
      parsePlacementAnswer(question, { machine: 'studio', reason: ' Simulator tests run here. ' })
    ).toEqual({
      machineId: 'studio',
      reason: 'Simulator tests run here.',
    });
    expect(
      parsePlacementAnswer(question, { machine: 'server', reason: 'x'.repeat(300) })?.reason
    ).toHaveLength(240);
    expect(parsePlacementAnswer(question, { machine: 'server' })).toEqual({
      machineId: 'server',
      reason: '',
    });
    expect(
      parsePlacementAnswer(question, { machine: NO_POLICY_MACHINE, reason: 'No policy fits.' })
    ).toBeNull();
    expect(parsePlacementAnswer(question, { machine: 7 })).toBeNull();
    expect(parsePlacementAnswer(question, null)).toBeNull();
    expect(parsePlacementAnswer(question, 'studio')).toBeNull();
  });

  test('a question from a page is checked field by field before the classifier sees it', () => {
    const json = JSON.parse(JSON.stringify(question)) as unknown;
    expect(parsePlacementQuestion(json)).toEqual(question);
    const candidate = question.machines[0];
    const broken: unknown[] = [
      null,
      'question',
      { ...question, request: ' ' },
      { ...question, request: 'x'.repeat(20_001) },
      { ...question, machines: [candidate] },
      { ...question, machines: 'all' },
      {
        ...question,
        machines: Array.from({ length: 21 }, (_, index) => ({ ...candidate, id: `m${index}` })),
      },
      { ...question, machines: [candidate, candidate] },
      { ...question, machines: [candidate, null] },
      { ...question, machines: [candidate, { ...candidate, id: '' }] },
      { ...question, machines: [candidate, { ...candidate, id: 'b', name: 3 }] },
      { ...question, machines: [candidate, { ...candidate, id: 'b', policies: 'all' }] },
      { ...question, machines: [candidate, { ...candidate, id: 'b', policies: [3] }] },
      { ...question, machines: [candidate, { ...candidate, id: 'b', policies: ['x'.repeat(241)] }] },
      { ...question, machines: [candidate, { ...candidate, id: 'b', open: -1 }] },
      { ...question, machines: [candidate, { ...candidate, id: 'b', open: 1.5 }] },
      { ...question, machines: [candidate, { ...candidate, id: 'b', capacity: 0 }] },
      { ...question, machines: [candidate, { ...candidate, id: 'b', capacity: 'none' }] },
    ];
    for (const value of broken) expect(parsePlacementQuestion(value)).toBeNull();
    expect(
      parsePlacementQuestion({
        ...question,
        machines: [candidate, { ...candidate, id: 'b', name: 'n'.repeat(200) }],
      })?.machines[1]?.name
    ).toHaveLength(120);
  });

  test('a project still wins, and room decides the rest', () => {
    expect(
      resolvePlacement([studio, { ...server, state: { ...server.state, projects: { p: {} } } }], 'p')
    ).toBe('server');
    expect(resolvePlacement([server, studio], null)).toBe('studio');
  });
});
