import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  INITIATIVE_LIMITS,
  isInFocus,
  listInitiativeMembers,
  listInitiatives,
  listTaskDescendants,
  resolveFocusInitiative,
  resolveFocusProjects,
  resolveQueue,
  type Task,
} from '../../src/index.ts';
import {
  createHarness,
  createInitiative,
  createTask,
  decideOrThrow,
  type Harness,
  proposePlan,
} from '../harness.ts';

function write(
  harness: Harness,
  initiativeId: string,
  name: string,
  options: { description?: string; phases?: { id: string | null; name: string }[] } = {}
) {
  harness.send({
    type: 'initiative.write',
    initiativeId,
    name,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.phases ? { phases: options.phases } : {}),
  });
}

function initiativeOf(harness: Harness, id: string) {
  const initiative = harness.state.initiatives[id];
  if (!initiative) throw new Error(`no initiative ${id}`);
  return initiative;
}

function join(harness: Harness, taskId: string, initiativeId: string | null, phaseId: string | null = null) {
  harness.send({ type: 'task.join_initiative', taskId, initiativeId, phaseId });
}

function refusal(harness: Harness, command: Parameters<Harness['send']>[0]) {
  try {
    harness.send(command);
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
}

function withPhases(harness: Harness) {
  const { initiativeId: id, leadId } = createInitiative(harness, {
    description: '  Restart the chat stack as small pull requests.  ',
    phases: ['Dock', 'Studio'],
  });
  const [dock, studio] = initiativeOf(harness, id).phases;
  return { id, leadId, dock: dock?.id ?? '', studio: studio?.id ?? '' };
}

describe('starting an initiative', () => {
  test('is a task of kind lead: its first line names it and the rest describes it', () => {
    const harness = createHarness();
    const { id, leadId } = withPhases(harness);
    expect(initiativeOf(harness, id)).toMatchObject({
      name: 'Chat split',
      description: 'Restart the chat stack as small pull requests.',
      phases: [{ name: 'Dock' }, { name: 'Studio' }],
      leadTaskId: leadId,
    });
    expect(harness.task(leadId)).toMatchObject({ initiativeId: id, repoId: null });
    expect(listInitiativeMembers(harness.state, id).map((task) => task.id)).toEqual([leadId]);
  });

  test('ignores an initiative, phase or stack named on the new task', () => {
    const harness = createHarness();
    const { id, dock } = withPhases(harness);
    const other = createTask(harness);
    harness.send({
      type: 'task.create',
      request: 'Studio rewrite',
      repoId: null,
      initiative: true,
      initiativeId: id,
      initiativePhaseId: dock,
      stacksOn: [other],
    });
    const created = listInitiatives(harness.state).at(-1);
    const lead = harness.task(created?.leadTaskId ?? '');
    expect(created?.id).not.toBe(id);
    expect(lead).toMatchObject({ initiativeId: created?.id, initiativePhaseId: null });
    expect(lead.stacksOn ?? []).toEqual([]);
  });

  test('names itself after the first written line, and refuses one past the limit of open initiatives', () => {
    const harness = createHarness();
    const { initiativeId } = createInitiative(harness, { name: '  \n Docs  rewrite ' });
    expect(initiativeOf(harness, initiativeId)).toMatchObject({ name: 'Docs rewrite', description: '' });
    for (let index = 1; index < INITIATIVE_LIMITS.initiatives; index += 1) {
      createInitiative(harness, { name: `Effort ${index}` });
    }
    expect(
      refusal(harness, { type: 'task.create', request: 'One more', repoId: null, initiative: true })
    ).toBe('initiative_limit');
    const first = listInitiatives(harness.state)[0];
    harness.send({ type: 'task.complete', taskId: first?.leadTaskId ?? '' });
    createInitiative(harness, { name: 'One more' });
    expect(listInitiatives(harness.state)).toHaveLength(INITIATIVE_LIMITS.initiatives + 1);
  });
});

describe('editing an initiative', () => {
  test('changes its name and phases in place', () => {
    const harness = createHarness();
    const { id, dock } = withPhases(harness);
    write(harness, id, '  Chat   rewrite ', { phases: [{ id: dock, name: 'Dock host' }] });
    expect(initiativeOf(harness, id)).toMatchObject({
      name: 'Chat rewrite',
      description: 'Restart the chat stack as small pull requests.',
      phases: [{ id: dock, name: 'Dock host' }],
    });
  });

  test('keeps its phases when a write leaves them out, and changes nothing for the same values', () => {
    const harness = createHarness();
    const { id } = withPhases(harness);
    const before = harness.events.length;
    write(harness, id, 'Chat split');
    expect(harness.events.length).toBe(before);
    expect(initiativeOf(harness, id).phases).toHaveLength(2);
  });

  test('takes members of a removed phase out of it, but keeps them in the initiative', () => {
    const harness = createHarness();
    const { id, dock, studio } = withPhases(harness);
    const taskId = createTask(harness);
    join(harness, taskId, id, studio);
    write(harness, id, 'Chat split', { phases: [{ id: dock, name: 'Dock' }] });
    expect(harness.task(taskId)).toMatchObject({ initiativeId: id, initiativePhaseId: null });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Taken out of its phase');
  });

  test.each([
    ['an empty name', '   ', undefined, undefined],
    ['a long name', 'x'.repeat(INITIATIVE_LIMITS.name + 1), undefined, undefined],
    ['a long description', 'Chat', 'x'.repeat(INITIATIVE_LIMITS.description + 1), undefined],
    ['an unnamed phase', 'Chat', undefined, [{ id: null, name: ' ' }]],
    [
      'a long phase name',
      'Chat',
      undefined,
      [{ id: null, name: 'x'.repeat(INITIATIVE_LIMITS.phaseName + 1) }],
    ],
    [
      'two phases with one name',
      'Chat',
      undefined,
      [
        { id: null, name: 'Dock' },
        { id: null, name: 'dock' },
      ],
    ],
    [
      'too many phases',
      'Chat',
      undefined,
      Array.from({ length: INITIATIVE_LIMITS.phases + 1 }, (_, index) => ({ id: null, name: `P${index}` })),
    ],
    ['a phase it does not have', 'Chat', undefined, [{ id: 'nope', name: 'Dock' }]],
  ])('refuses %s', (_label, name, description, phases) => {
    const harness = createHarness();
    const { id } = withPhases(harness);
    expect(
      refusal(harness, {
        type: 'initiative.write',
        initiativeId: id,
        name,
        ...(description !== undefined ? { description } : {}),
        ...(phases ? { phases } : {}),
      })
    ).toBe('initiative_invalid');
  });

  test('refuses an initiative that does not exist', () => {
    const harness = createHarness();
    expect(refusal(harness, { type: 'initiative.write', initiativeId: 'nope', name: 'Chat' })).toBe(
      'initiative_not_found'
    );
  });
});

describe('membership', () => {
  test('a task joins an initiative in a phase, moves phase and leaves, each recorded on the task', () => {
    const harness = createHarness();
    const { id, dock, studio } = withPhases(harness);
    const taskId = createTask(harness);
    join(harness, taskId, id);
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Added to the initiative Chat split');
    join(harness, taskId, id, dock);
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Moved to the phase Dock');
    join(harness, taskId, null);
    join(harness, taskId, id, studio);
    expect(harness.task(taskId)).toMatchObject({ initiativeId: id, initiativePhaseId: studio });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Added to the initiative Chat split, phase Studio'
    );
    expect(listInitiativeMembers(harness.state, id).map((task) => task.id)).toContain(taskId);
    join(harness, taskId, null);
    expect(harness.task(taskId)).toMatchObject({ initiativeId: null, initiativePhaseId: null });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Removed from the initiative Chat split');
  });

  test('joining where it already is changes nothing, and leaving when it is in none records nothing', () => {
    const harness = createHarness();
    const { id, dock } = withPhases(harness);
    const taskId = createTask(harness);
    join(harness, taskId, null);
    join(harness, taskId, id, dock);
    const before = harness.events.length;
    join(harness, taskId, id, dock);
    expect(harness.events.length).toBe(before);
  });

  test('a task that leaves a removed initiative records no line about it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const lines = harness.task(taskId).activity.length;
    harness.replay({ type: 'task.initiative_changed', taskId, initiativeId: null, phaseId: null });
    harness.replay({ type: 'task.initiative_changed', taskId: 'gone', initiativeId: null, phaseId: null });
    expect(harness.task(taskId).activity).toHaveLength(lines);
  });

  test('refuses a phase the initiative does not have and an initiative that does not exist', () => {
    const harness = createHarness();
    const { id } = withPhases(harness);
    const taskId = createTask(harness);
    expect(
      refusal(harness, { type: 'task.join_initiative', taskId, initiativeId: id, phaseId: 'nope' })
    ).toBe('initiative_phase_not_found');
    expect(
      refusal(harness, { type: 'task.join_initiative', taskId, initiativeId: 'nope', phaseId: null })
    ).toBe('initiative_not_found');
  });

  test('a finished initiative takes no new tasks, and its members’ forks join none', () => {
    const harness = createHarness();
    const { id, leadId } = withPhases(harness);
    const member = createTask(harness);
    join(harness, member, id);
    harness.send({ type: 'task.complete', taskId: leadId });
    expect(harness.state.initiatives[id]).toBeDefined();
    const taskId = createTask(harness);
    expect(refusal(harness, { type: 'task.join_initiative', taskId, initiativeId: id, phaseId: null })).toBe(
      'initiative_finished'
    );
    harness.send({ type: 'task.create', request: 'Try another dock', repoId: null, forkOf: member });
    expect(Object.values(harness.state.tasks).at(-1)?.initiativeId).toBeUndefined();
  });

  test('a new task can start in an initiative and phase', () => {
    const harness = createHarness();
    const { id, studio } = withPhases(harness);
    harness.send({
      type: 'task.create',
      request: 'Port the studio chat',
      repoId: null,
      initiativeId: id,
      initiativePhaseId: studio,
    });
    const task = Object.values(harness.state.tasks).at(-1);
    expect(task).toMatchObject({ initiativeId: id, initiativePhaseId: studio });
  });

  test('a fork joins the initiative and phase of the task it forks', () => {
    const harness = createHarness();
    const { id, dock } = withPhases(harness);
    const taskId = createTask(harness);
    join(harness, taskId, id, dock);
    harness.send({ type: 'task.create', request: 'Try another dock', repoId: null, forkOf: taskId });
    expect(Object.values(harness.state.tasks).at(-1)).toMatchObject({
      forkOf: taskId,
      initiativeId: id,
      initiativePhaseId: dock,
    });
  });

  test('a fork of a task outside any initiative, or of one whose phase is gone, joins no phase', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.create', request: 'Try another dock', repoId: null, forkOf: taskId });
    expect(Object.values(harness.state.tasks).at(-1)?.initiativeId).toBeUndefined();
    const { id } = withPhases(harness);
    harness.replay({ type: 'task.initiative_changed', taskId, initiativeId: id, phaseId: 'gone' });
    harness.send({ type: 'task.create', request: 'Try a third dock', repoId: null, forkOf: taskId });
    const fork = Object.values(harness.state.tasks).at(-1);
    expect(fork).toMatchObject({ initiativeId: id });
    expect(fork?.initiativePhaseId).toBeUndefined();
  });
});

describe('cancelling an initiative', () => {
  test('takes every member out and clears a focus on it', () => {
    const harness = createHarness();
    const { id, leadId } = withPhases(harness);
    const taskId = createTask(harness);
    join(harness, taskId, id);
    harness.send({ type: 'focus.change', projectId: null, initiativeId: id, until: null });
    harness.send({ type: 'task.cancel', taskId: leadId });
    expect(harness.state.initiatives[id]).toBeUndefined();
    expect(harness.task(taskId).initiativeId).toBeNull();
    expect(harness.state.focus.initiativeId).toBeUndefined();
    expect(harness.lastEffect('briefing.request')).toMatchObject({ projectId: null });
  });

  test('leaves a focus on something else alone, and other cancellations change nothing', () => {
    const harness = createHarness();
    const { id, leadId } = withPhases(harness);
    const other = createTask(harness);
    harness.send({ type: 'task.cancel', taskId: other });
    expect(harness.state.initiatives[id]).toBeDefined();
    harness.send({ type: 'task.cancel', taskId: leadId });
    expect(listInitiatives(harness.state)).toEqual([]);
    expect(harness.state.focus.initiativeId).toBeUndefined();
  });
});

describe('making an initiative from a task', () => {
  test('names it after the task and adds the task and every task it led to', () => {
    const harness = createHarness();
    const rootId = createTask(harness, { request: 'Rewrite the agent dock' });
    proposePlan(harness, rootId);
    harness.send({
      type: 'agent.create_task',
      runId: harness.activeRun(rootId).id,
      requestKey: 'next',
      request: 'Port the chat page.',
      repoId: null,
      thisWaits: false,
      afterThis: false,
    });
    const childId = Object.values(harness.state.tasks).at(-1)?.id ?? '';
    harness.send({ type: 'task.create', request: 'Try the chat page again', repoId: null, forkOf: childId });
    const forkId = Object.values(harness.state.tasks).at(-1)?.id ?? '';
    const elsewhere = createInitiative(harness, { name: 'Elsewhere' }).initiativeId;
    harness.send({ type: 'task.create', request: 'Another fork', repoId: null, forkOf: childId });
    const otherId = Object.values(harness.state.tasks).at(-1)?.id ?? '';
    join(harness, otherId, elsewhere);
    const unrelated = createTask(harness, { request: 'Something else' });
    harness.send({ type: 'initiative.adopt_task', taskId: rootId });
    const id = listInitiatives(harness.state).at(-1)?.id ?? '';
    const initiative = initiativeOf(harness, id);
    expect(initiative.name).toBe('Rewrite the agent dock');
    const lead = harness.task(initiative.leadTaskId ?? '');
    expect(lead).toMatchObject({ forkOf: rootId, initiativeId: id });
    const members = listInitiativeMembers(harness.state, id).map((task) => task.id);
    expect(members.sort()).toEqual([rootId, childId, forkId, lead.id].sort());
    expect(harness.task(otherId).initiativeId).toBe(elsewhere);
    expect(harness.task(unrelated).initiativeId).toBeUndefined();
  });

  test('refuses a task already in an initiative, and names an untitled one', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'initiative.adopt_task', taskId });
    expect(refusal(harness, { type: 'initiative.adopt_task', taskId })).toBe('initiative_exists');
    const blank = createTask(harness, { request: 'Something' });
    const state = {
      ...harness.state,
      tasks: { ...harness.state.tasks, [blank]: { ...harness.task(blank), title: '   ' } },
    };
    const decision = decideOrThrow(
      state,
      { type: 'initiative.adopt_task', taskId: blank },
      {
        now: harness.now + 1,
        newId: () => 'blank',
      }
    );
    expect(decision.events[0]).toMatchObject({
      type: 'initiative.written',
      initiative: { name: 'Untitled initiative' },
    });
  });

  test('listTaskDescendants follows creators, splits and forks, and stops at unrelated tasks', () => {
    const task = (id: string, extra: Partial<Task> = {}) => ({ id, ...extra }) as Task;
    const tasks = [
      task('a'),
      task('b', { parentTaskId: 'a' }),
      task('c', { forkOf: 'b' }),
      task('d', { createdBy: { kind: 'courier', taskId: 'c', runId: 'r', requestKey: 'k' } }),
      task('e', { forkOf: null, parentTaskId: null }),
    ];
    expect(listTaskDescendants(tasks, 'a').map((entry) => entry.id)).toEqual(['b', 'c', 'd']);
  });
});

describe('focusing on an initiative', () => {
  test('narrows the queue to its members and keys the briefing apart', () => {
    const harness = createHarness();
    const { id } = withPhases(harness);
    const member = createTask(harness);
    const other = createTask(harness);
    join(harness, member, id);
    harness.send({ type: 'focus.change', projectId: null, initiativeId: id, until: harness.now + 10_000 });
    expect(Option.getOrNull(resolveFocusInitiative(harness.state, harness.now))).toBe(id);
    expect(resolveFocusProjects(harness.state, harness.now)).toEqual({ projectIds: [], except: false });
    expect(isInFocus(harness.state, harness.task(member), harness.now)).toBe(true);
    expect(isInFocus(harness.state, harness.task(other), harness.now)).toBe(false);
    expect(resolveQueue(harness.state, harness.now).focusInitiativeId).toBe(id);
    expect(Option.getOrNull(resolveFocusInitiative(harness.state, harness.now + 20_000))).toBeNull();
    harness.send({ type: 'focus.change', projectId: null, until: null });
    expect(Option.getOrNull(resolveFocusInitiative(harness.state, harness.now))).toBeNull();
  });

  test('refuses an unknown initiative and a focus on an initiative and anything else at once', () => {
    const harness = createHarness();
    const { id } = withPhases(harness);
    expect(
      refusal(harness, { type: 'focus.change', projectId: null, initiativeId: 'nope', until: null })
    ).toBe('initiative_not_found');
    expect(
      refusal(harness, {
        type: 'focus.change',
        projectId: null,
        initiativeId: id,
        teamId: 'team',
        until: null,
      })
    ).toBe('focus_refused');
  });
});

describe('on your behalf', () => {
  test('records what an agent did to initiatives for you', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const send = (command: Parameters<Harness['send']>[0]) =>
      harness.send(command, { onBehalf: true, byTask: taskId });
    const { initiativeId: id } = createInitiative(harness);
    send({ type: 'initiative.write', initiativeId: id, name: 'Chat rewrite' });
    send({ type: 'task.join_initiative', taskId, initiativeId: id, phaseId: null });
    send({ type: 'task.join_initiative', taskId, initiativeId: null, phaseId: null });
    send({ type: 'focus.change', projectId: null, initiativeId: id, until: null });
    send({ type: 'initiative.adopt_task', taskId });
    expect(harness.state.onBehalfActions.map((action) => action.summary)).toEqual([
      'Changed the initiative “Chat rewrite”',
      'Added “Fix tab group scroll” to the initiative “Chat rewrite”',
      'Took “Fix tab group scroll” out of its initiative',
      'Focused on the initiative “Chat rewrite”',
      'Made an initiative from “Fix tab group scroll”',
    ]);
  });
});
