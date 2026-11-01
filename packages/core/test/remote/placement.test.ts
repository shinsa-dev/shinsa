import { describe, expect, test } from 'bun:test';
import type { TaskStage } from '../../src/domain/types.ts';
import {
  isPlacementPoliciesValid,
  listPlacementCandidates,
  NO_PLACEMENT_MACHINE,
  type PlacementCandidate,
  type PlacementMachine,
  parsePlacementAnswer,
  parsePlacementQuestion,
  resolveMachineLoad,
  resolvePlacement,
  resolveProjectMachine,
  serializePlacementPrompt,
} from '../../src/remote/placement.ts';
import type { ResourceSummary } from '../../src/remote/resources.ts';

const GB = 1024 ** 3;

function use(cpuPercent: number, memoryUsedGb: number, memoryTotalGb = 32): ResourceSummary {
  return {
    cores: 8,
    cpuPercent,
    memoryUsedBytes: memoryUsedGb * GB,
    memoryTotalBytes: memoryTotalGb * GB,
    diskFreeBytes: 120 * GB,
  };
}

function machine(
  id: string,
  stages: TaskStage[],
  options: {
    capacity?: number | null;
    projects?: string[];
    repos?: { name: string; projectId: string | null }[];
    policies?: string[];
    resources?: ResourceSummary | null;
  } = {}
): PlacementMachine {
  return {
    ...(options.resources === undefined ? {} : { resources: options.resources }),
    id,
    name: id,
    state: {
      tasks: Object.fromEntries(stages.map((stage, index) => [`${id}-${index}`, { stage }])),
      projects: Object.fromEntries(
        (options.projects ?? []).map((project) => [project, { name: project, description: '' }])
      ),
      repos: Object.fromEntries((options.repos ?? []).map((repo) => [repo.name, repo])),
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
      headroom: null,
    });
    expect(resolveMachineLoad(machine('b', ['building']))).toMatchObject({ capacity: null, full: false });
    expect(resolveMachineLoad(machine('c', [], { resources: use(42, 8) })).headroom).toBe(55);
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

  test('with every machine reporting, the one with the most free CPU and memory takes it', () => {
    const busy = machine('busy', [], { resources: use(90, 4) });
    const swapping = machine('swapping', [], { resources: use(10, 30) });
    const idle = machine('idle', ['building', 'building', 'building'], { resources: use(20, 8) });
    expect(resolvePlacement([busy, swapping, idle], null)).toBe('idle');
  });

  test('headroom counts in steps, so near-equal machines fall back to open tasks', () => {
    expect(
      resolvePlacement(
        [
          machine('a', ['building', 'building'], { resources: use(21, 4) }),
          machine('b', ['building'], { resources: use(24, 4) }),
        ],
        null
      )
    ).toBe('b');
  });

  test('capacity still wins over headroom, and a project over both', () => {
    const full = machine('full', ['building'], { capacity: 1, resources: use(0, 0), projects: ['p'] });
    const busy = machine('busy', ['building'], { capacity: 4, resources: use(95, 30) });
    expect(resolvePlacement([full, busy], null)).toBe('busy');
    expect(resolvePlacement([full, busy], 'p')).toBe('full');
  });

  test('when a machine reports no resources, room alone decides as before', () => {
    expect(
      resolvePlacement(
        [
          machine('old', ['building'], { capacity: 4 }),
          machine('new', ['building', 'building'], { capacity: 4, resources: use(0, 0) }),
        ],
        null
      )
    ).toBe('old');
    expect(
      resolvePlacement(
        [machine('old', [], { resources: null }), machine('new', ['building'], { resources: use(0, 0) })],
        null
      )
    ).toBe('old');
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
  const bare = machine('bare', [], { resources: use(42.4, 12.25) });
  const question = {
    request: 'Run the iOS simulator tests',
    machines: listPlacementCandidates([studio, server, bare]),
  };

  test('a machine holds up to 20 policies of 1 to 240 characters', () => {
    expect(isPlacementPoliciesValid(['Run iOS work here.'])).toBe(true);
    expect(isPlacementPoliciesValid([' '])).toBe(false);
    expect(isPlacementPoliciesValid(['x'.repeat(241)])).toBe(false);
    expect(isPlacementPoliciesValid(Array.from({ length: 21 }, (_, index) => `p${index}`))).toBe(false);
  });

  test('the prompt lists every machine with its load and its policies in plain English, then the request', () => {
    expect(question.machines[1]).toEqual({
      id: 'server',
      name: 'server',
      policies: ['Benchmarks and load tests always run here.'],
      projects: [],
      repositories: [],
      open: 2,
      capacity: 4,
      resources: null,
    });
    expect(question.machines[2]?.resources).toEqual(use(42.4, 12.25));
    const prompt = serializePlacementPrompt(question);
    expect(prompt).toContain(
      'Machine "studio" named studio (1 open tasks, no limit; resource use not reported)\nPolicies:\n  - Run Xcode simulator tests'
    );
    expect(prompt).toContain(
      'Machine "server" named server (2 of 4 open tasks; resource use not reported)\n'
    );
    expect(prompt).toContain(
      'Machine "bare" named bare (0 open tasks, no limit; CPU 42% of 8 cores, memory 12 of 32 GB used, 120 GB disk free)\nPolicies:\n  (no policies)\nProjects:\n  (no projects)'
    );
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
      parsePlacementAnswer(question, { machine: NO_PLACEMENT_MACHINE, reason: 'No policy fits.' })
    ).toBeNull();
    expect(parsePlacementAnswer(question, { machine: 7 })).toBeNull();
    expect(parsePlacementAnswer(question, null)).toBeNull();
    expect(parsePlacementAnswer(question, 'studio')).toBeNull();
  });

  test('each machine lists the projects it holds with their repositories, and the repositories outside one', () => {
    const app = machine('app', [], {
      projects: ['web'],
      repos: [
        { name: 'web-app', projectId: 'web' },
        { name: 'scratch', projectId: null },
        { name: 'orphan', projectId: 'gone' },
      ],
    });
    app.state.projects.web = { name: 'Web', description: ' The customer site. ' };
    const [candidate] = listPlacementCandidates([app]);
    expect(candidate?.projects).toEqual([
      { name: 'Web', description: ' The customer site. ', repositories: ['web-app'] },
    ]);
    expect(candidate?.repositories).toEqual(['scratch', 'orphan']);
    const prompt = serializePlacementPrompt({
      request: 'Fix the checkout page',
      machines: [candidate!, question.machines[0]!],
    });
    expect(prompt).toContain(
      'Projects:\n  - Web (repositories: web-app): The customer site.\nOther repositories: scratch, orphan'
    );
    const plain = { ...candidate!, projects: [{ name: 'Bare', description: ' ', repositories: [] }] };
    expect(serializePlacementPrompt({ request: 'x', machines: [plain, plain] })).toContain('  - Bare\n');
    const many = machine('many', [], { projects: Array.from({ length: 60 }, (_, index) => `p${index}`) });
    expect(listPlacementCandidates([many])[0]?.projects).toHaveLength(50);
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
      { ...question, machines: [candidate, { ...candidate, id: 'b', resources: { cores: 0 } }] },
      { ...question, machines: [candidate, { ...candidate, id: 'b', projects: 'all' }] },
      { ...question, machines: [candidate, { ...candidate, id: 'b', projects: [null] }] },
      {
        ...question,
        machines: [candidate, { ...candidate, id: 'b', projects: [{ name: 'p', description: 3 }] }],
      },
      {
        ...question,
        machines: [
          candidate,
          { ...candidate, id: 'b', projects: [{ name: 'p', description: '', repositories: [3] }] },
        ],
      },
      { ...question, machines: [candidate, { ...candidate, id: 'b', repositories: 'all' }] },
      {
        ...question,
        machines: [candidate, { ...candidate, id: 'b', repositories: Array.from({ length: 31 }, () => 'r') }],
      },
    ];
    for (const value of broken) expect(parsePlacementQuestion(value)).toBeNull();
    expect(
      parsePlacementQuestion({
        ...question,
        machines: [candidate, { ...candidate, id: 'b', name: 'n'.repeat(200) }],
      })?.machines[1]?.name
    ).toHaveLength(120);
    const long = parsePlacementQuestion({
      ...question,
      machines: [
        candidate,
        {
          ...candidate,
          id: 'b',
          projects: [
            { name: 'n'.repeat(200), description: 'd'.repeat(400), repositories: ['r'.repeat(200)] },
          ],
        },
      ],
    })?.machines[1]?.projects[0];
    expect([long?.name.length, long?.description.length, long?.repositories[0]?.length]).toEqual([
      120, 300, 120,
    ]);
    const older: Partial<PlacementCandidate> = { ...question.machines[0] };
    delete older.resources;
    expect(
      parsePlacementQuestion({ ...question, machines: [older, { ...older, id: 'b' }] })?.machines[1]
        ?.resources
    ).toBeNull();
  });

  test('a project still wins, and room decides the rest', () => {
    expect(
      resolvePlacement(
        [studio, { ...server, state: { ...server.state, projects: { p: { name: 'P', description: '' } } } }],
        'p'
      )
    ).toBe('server');
    expect(resolvePlacement([server, studio], null)).toBe('studio');
  });
});
