import { describe, expect, test } from 'bun:test';
import {
  type CommandOf,
  listActiveRuns,
  listOpenGates,
  parseUserCommand,
  type TeammateOriginal,
} from '../../src/index.ts';
import {
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  readyWorktree,
  registerRepo,
} from '../harness.ts';

function createUntriaged(harness: Harness, request: string) {
  const repoId = Object.keys(harness.state.repos)[0] || registerRepo(harness);
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({ type: 'task.create', request, repoId });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  return { taskId, repoId };
}

function triageAsDuplicate(
  harness: Harness,
  request: string,
  duplicateOf: string,
  why?: string,
  waitsOn: string[] = []
) {
  const { taskId, repoId } = createUntriaged(harness, request);
  harness.send({
    type: 'task.triage',
    taskId,
    title: request,
    repoId,
    size: 'small',
    branch: `fix/${taskId}`,
    waitsOn,
    duplicateOf,
    ...(why ? { reasons: { duplicate: why } } : {}),
  });
  return taskId;
}

describe('duplicates', () => {
  test('marking a task a duplicate cancels it and links the original', () => {
    const harness = createHarness();
    const original = createTask(harness, { request: 'Add dark mode' });
    const copy = createTask(harness, { request: 'Support a dark theme' });
    harness.send({ type: 'task.mark_duplicate', taskId: copy, duplicateOf: original });

    const task = harness.task(copy);
    expect(task.stage).toBe('cancelled');
    expect(task.duplicate).toEqual({ of: original, by: 'you', why: null });
    expect(task.stageReason).toBe(`duplicate of ${harness.task(original).handle} “Add dark mode”`);
    expect(task.closedAt).not.toBeNull();
    expect(listActiveRuns(harness.state, copy)).toHaveLength(0);
    expect(harness.lastEffect('worktree.remove').taskId).toBe(copy);
    const texts = task.activity.map((entry) => entry.text);
    expect(texts).toContain(`Closed as a duplicate of ${harness.task(original).handle} “Add dark mode”`);
    expect(texts).not.toContain('Cancelled');
    expect(harness.task(original).stage).toBe('planning');
  });

  test('a task cannot duplicate itself, a duplicate, or close once finished', () => {
    const harness = createHarness();
    const original = createTask(harness, { request: 'Add dark mode' });
    const first = createTask(harness, { request: 'Dark theme' });
    const second = createTask(harness, { request: 'Night mode' });
    expect(() => harness.send({ type: 'task.mark_duplicate', taskId: first, duplicateOf: first })).toThrow(
      'cannot duplicate itself'
    );
    harness.send({ type: 'task.mark_duplicate', taskId: first, duplicateOf: original });
    expect(() => harness.send({ type: 'task.mark_duplicate', taskId: second, duplicateOf: first })).toThrow(
      'is itself a duplicate'
    );
    expect(() => harness.send({ type: 'task.mark_duplicate', taskId: first, duplicateOf: second })).toThrow(
      'This task is finished.'
    );
  });

  test('triage closes a request that duplicates an open task before any work starts', () => {
    const harness = createHarness();
    const original = createTask(harness, { request: 'Add dark mode' });
    const copy = triageAsDuplicate(harness, 'Dark theme please', original, 'Both ask for a dark theme.');

    const task = harness.task(copy);
    expect(task.stage).toBe('cancelled');
    expect(task.handle).toBeTruthy();
    expect(task.duplicate).toEqual({ of: original, by: 'shinsa', why: 'Both ask for a dark theme.' });
    expect(harness.effectsOf('config.verify').map((effect) => effect.taskId)).not.toContain(copy);
    expect(listActiveRuns(harness.state, copy)).toHaveLength(0);
    const closed = task.activity.find((entry) => entry.text.startsWith('Closed as a duplicate'));
    expect(closed?.actor).toBe('shinsa');
    expect(closed?.person).toBeUndefined();
  });

  test('triage ignores a duplicate that names itself, a finished task, a duplicate or no task', () => {
    const harness = createHarness();
    const finished = createTask(harness, { request: 'Old work' });
    harness.send({ type: 'task.cancel', taskId: finished });
    const original = createTask(harness, { request: 'Add dark mode' });
    const duplicate = triageAsDuplicate(harness, 'Dark theme', original);

    for (const named of [finished, duplicate, 'missing']) {
      const taskId = triageAsDuplicate(harness, `Separate work for ${named}`, named);
      expect(harness.task(taskId).stage).toBe('triage');
      expect(harness.task(taskId).duplicate ?? null).toBeNull();
    }
    const { taskId, repoId } = createUntriaged(harness, 'Itself');
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'Itself',
      repoId,
      size: 'small',
      branch: 'fix/itself',
      waitsOn: [],
      duplicateOf: taskId,
    });
    expect(harness.task(taskId).stage).toBe('triage');
  });

  test('not a duplicate starts a task triage closed as if it was never flagged', () => {
    const harness = createHarness();
    const original = createTask(harness, { request: 'Add dark mode' });
    const copy = triageAsDuplicate(harness, 'Dark theme for the editor only', original);
    harness.send({ type: 'task.clear_duplicate', taskId: copy });

    const task = harness.task(copy);
    expect(task.duplicate).toBeNull();
    expect(task.closedAt).toBeNull();
    expect(task.cancelledFrom).toBeNull();
    expect(task.stage).toBe('triage');
    expect(harness.lastEffect('config.verify').taskId).toBe(copy);
    expect(task.activity.map((entry) => entry.text)).toContain('Not a duplicate after all');
    readyWorktree(harness, copy);
    expect(harness.task(copy).stage).toBe('planning');
    expect(harness.task(copy).rounds?.at(-1)?.status).toBe('active');
  });

  test('not a duplicate keeps what triage made the task wait on', () => {
    const harness = createHarness();
    const blocker = createTask(harness, { request: 'Add the theme tokens' });
    const original = createTask(harness, { request: 'Add dark mode' });
    const copy = triageAsDuplicate(harness, 'Dark theme on the tokens', original, undefined, [blocker]);
    expect(harness.task(copy).waitsOn).toEqual([blocker]);
    harness.send({ type: 'task.clear_duplicate', taskId: copy });

    expect(harness.task(copy).waitsOn).toEqual([blocker]);
    expect(harness.task(copy).stage).toBe('waiting_on_tasks');
    expect(harness.effectsOf('config.verify').map((effect) => effect.taskId)).not.toContain(copy);
  });

  test('a task that is not a duplicate cannot be started as one', () => {
    const harness = createHarness();
    const copy = createTask(harness, { request: 'Dark theme' });
    expect(() => harness.send({ type: 'task.clear_duplicate', taskId: copy })).toThrow(
      'This task is not closed as a duplicate.'
    );
  });

  test('a duplicate you closed mid-work starts again in a fresh round on a new branch', () => {
    const harness = createHarness();
    const original = createTask(harness, { request: 'Add dark mode' });
    const copy = createTask(harness, { request: 'Dark theme' });
    proposePlan(harness, copy);
    const branch = harness.task(copy).branch;
    harness.send({ type: 'task.mark_duplicate', taskId: copy, duplicateOf: original });
    expect(harness.task(copy).stage).toBe('cancelled');
    harness.send({ type: 'task.clear_duplicate', taskId: copy });

    const task = harness.task(copy);
    expect(task.duplicate).toBeNull();
    expect(task.closedAt).toBeNull();
    expect(task.plan).toBeNull();
    expect(task.phaseReports).toEqual([]);
    expect(task.rounds?.map((round) => [round.number, round.status])).toEqual([
      [1, 'cancelled'],
      [2, 'active'],
    ]);
    expect(task.rounds?.at(-1)?.request).toBe('Dark theme');
    expect(task.branch).toBe(`${branch}-round-2`);
    expect(task.stage).toBe('triage');
    readyWorktree(harness, copy);
    expect(harness.task(copy).stage).toBe('planning');
  });

  test('marking on your behalf says which task duplicates which', () => {
    const harness = createHarness();
    const original = createTask(harness, { request: 'Add dark mode' });
    const copy = createTask(harness, { request: 'Dark theme' });
    const other = triageAsDuplicate(harness, 'Night mode', original);
    harness.send({ type: 'task.mark_duplicate', taskId: copy, duplicateOf: original }, { onBehalf: true });
    harness.send({ type: 'task.clear_duplicate', taskId: other }, { onBehalf: true });
    const texts = harness.state.onBehalfActions.map((action) => action.summary);
    expect(texts).toContain('Closed “Dark theme” as a duplicate of “Add dark mode”');
    expect(texts).toContain('Started “Night mode” again, as not a duplicate');
    expect(listOpenGates(harness.state, copy)).toHaveLength(0);
  });

  test('the commands parse from untrusted input', () => {
    expect(parseUserCommand({ type: 'task.mark_duplicate', taskId: 'a', duplicateOf: 'b' })).toEqual({
      type: 'task.mark_duplicate',
      taskId: 'a',
      duplicateOf: 'b',
    });
    expect(parseUserCommand({ type: 'task.clear_duplicate', taskId: 'a' })).toEqual({
      type: 'task.clear_duplicate',
      taskId: 'a',
    });
    expect(() => parseUserCommand({ type: 'task.mark_duplicate', taskId: 'a' })).toThrow();
  });
});

const KAI_TASK: TeammateOriginal = {
  teamId: 'team-1',
  machineId: 'machine-kai',
  taskId: 'kai-task',
  handle: 'KAI-12',
  title: 'Add dark mode',
  owner: { login: 'kai', name: 'Kai Tanaka', avatarUrl: 'https://avatars.example/kai.png' },
};

function triageWith(harness: Harness, request: string, extra: Partial<CommandOf<'task.triage'>>) {
  const { taskId, repoId } = createUntriaged(harness, request);
  harness.send({
    type: 'task.triage',
    taskId,
    title: request,
    repoId,
    size: 'small',
    branch: `fix/${taskId}`,
    waitsOn: [],
    ...extra,
  });
  return taskId;
}

describe('teammate duplicates', () => {
  test("triage closes a request that repeats a teammate's open task and records that task", () => {
    const harness = createHarness();
    const copy = triageWith(harness, 'Dark theme please', {
      duplicateOfTeammate: KAI_TASK,
      reasons: { duplicate: 'Kai is already adding dark mode.' },
    });

    const task = harness.task(copy);
    expect(task.stage).toBe('cancelled');
    expect(task.stageReason).toBe('duplicate of Kai’s KAI-12 “Add dark mode”');
    expect(task.duplicate).toEqual({
      of: 'kai-task',
      by: 'shinsa',
      why: 'Kai is already adding dark mode.',
      teammate: KAI_TASK,
    });
    const closed = task.activity.find((entry) => entry.text.startsWith('Closed as a duplicate'));
    expect(closed?.text).toBe('Closed as a duplicate of Kai’s KAI-12 “Add dark mode”');
    expect(closed?.person).toEqual(KAI_TASK.owner ?? undefined);
    expect(harness.effectsOf('config.verify').map((effect) => effect.taskId)).not.toContain(copy);
    expect(listActiveRuns(harness.state, copy)).toHaveLength(0);
  });

  test("the recorded teammate's task is a copy, never the command's own object", () => {
    const harness = createHarness();
    const owner = { login: 'kai', name: 'Kai Tanaka', avatarUrl: null };
    const copy = triageWith(harness, 'Dark theme please', { duplicateOfTeammate: { ...KAI_TASK, owner } });
    owner.name = 'Someone else';

    expect(harness.task(copy).duplicate?.teammate?.owner?.name).toBe('Kai Tanaka');
  });

  test('a teammate is named by the first word of their name, or by their login when they have none', () => {
    const harness = createHarness();
    const blank = triageWith(harness, 'Dark theme please', {
      duplicateOfTeammate: { ...KAI_TASK, owner: { login: 'kai', name: '  ', avatarUrl: null } },
    });

    expect(harness.task(blank).stageReason).toBe('duplicate of kai’s KAI-12 “Add dark mode”');
  });

  test("a teammate's task without a handle or an owner is quoted by its title", () => {
    const harness = createHarness();
    const copy = triageWith(harness, 'Dark theme please', {
      duplicateOfTeammate: { ...KAI_TASK, handle: null, owner: null },
    });

    expect(harness.task(copy).stageReason).toBe('duplicate of “Add dark mode”');
    expect(harness.task(copy).duplicate?.why).toBeNull();
  });

  test("a local original wins over a teammate's task", () => {
    const harness = createHarness();
    const original = createTask(harness, { request: 'Add dark mode here' });
    const copy = triageWith(harness, 'Dark theme please', {
      duplicateOf: original,
      duplicateOfTeammate: KAI_TASK,
    });

    expect(harness.task(copy).duplicate).toEqual({ of: original, by: 'shinsa', why: null });
  });

  test("not a duplicate starts a teammate's duplicate as if triage had not flagged it", () => {
    const harness = createHarness();
    const copy = triageWith(harness, 'Dark theme for the editor only', { duplicateOfTeammate: KAI_TASK });
    harness.send({ type: 'task.clear_duplicate', taskId: copy });

    const task = harness.task(copy);
    expect(task.duplicate).toBeNull();
    expect(task.closedAt).toBeNull();
    expect(task.stage).toBe('triage');
    expect(harness.lastEffect('config.verify').taskId).toBe(copy);
    readyWorktree(harness, copy);
    expect(harness.task(copy).stage).toBe('planning');
  });

  test('triage records the team machines it could not compare with and says whose', () => {
    const harness = createHarness();
    const unreached = [
      {
        teamId: 'team-1',
        machineId: 'machine-kai',
        name: 'Studio',
        owner: { login: 'kai', name: null, avatarUrl: null },
      },
      { teamId: 'team-1', machineId: 'machine-box', name: 'Build box', owner: null },
    ];
    const taskId = triageWith(harness, 'Add a settings page', { unreached });

    const task = harness.task(taskId);
    expect(task.triageDecisions?.duplicate).toEqual({ unreached });
    expect(task.activity.map((entry) => entry.text)).toContain(
      'Could not check kai’s Studio and Build box for duplicates'
    );
    expect(task.stage).toBe('triage');
  });

  test('triage that reached every team machine, or had none to check, adds no line', () => {
    const harness = createHarness();
    const reached = triageWith(harness, 'Add a settings page', { unreached: [] });
    const local = triageWith(harness, 'Add an about page', {});

    expect(harness.task(reached).triageDecisions?.duplicate).toEqual({ unreached: [] });
    expect(harness.task(local).triageDecisions).not.toHaveProperty('duplicate');
    for (const taskId of [reached, local]) {
      expect(harness.task(taskId).activity.some((entry) => entry.text.includes('for duplicates'))).toBe(
        false
      );
    }
  });
});
