import { describe, expect, test } from 'bun:test';
import {
  listKeptMemory,
  listMemory,
  MEMORY_LIMITS,
  resolveRunBrief,
  resolveTaskProject,
} from '../../src/index.ts';
import {
  buildAll,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  PASSING,
  proposePlan,
  registerRepo,
} from '../harness.ts';

function remember(harness: Harness, taskId: string, scope: 'global' | 'project', text: string) {
  return harness.send({
    type: 'agent.remember',
    runId: harness.activeRun(taskId).id,
    scope,
    text,
    why: 'You asked for shorter plans twice.',
  });
}

function write(
  harness: Harness,
  text: string,
  projectId: string | null = null,
  memoryId: string | null = null
) {
  return harness.send({ type: 'memory.write', memoryId, projectId, text });
}

function projectOf(harness: Harness, taskId: string) {
  return resolveTaskProject(harness.state, harness.task(taskId)) ?? '';
}

function entries(harness: Harness) {
  return listMemory(harness.state);
}

describe('proposing a rule', () => {
  test('an agent proposes a rule for its project, which waits for you and shows in the task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    remember(harness, taskId, 'project', '  Keep plans to   three phases.  ');
    expect(entries(harness)).toMatchObject([
      {
        projectId: projectOf(harness, taskId),
        text: 'Keep plans to three phases.',
        why: 'You asked for shorter plans twice.',
        status: 'proposed',
        taskId,
        runId: run.id,
      },
    ]);
    expect(listKeptMemory(harness.state, projectOf(harness, taskId))).toEqual([]);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'agent',
      kind: 'suggestion',
      text: 'Proposed a rule for agents to remember',
      detail: 'Keep plans to three phases.',
      runId: run.id,
    });
  });

  test('a global rule belongs to no project', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    remember(harness, taskId, 'global', 'Never use em dashes.');
    expect(entries(harness)[0]?.projectId).toBeNull();
  });

  test('a rule already known for the same scope is dropped, whatever its case', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    remember(harness, taskId, 'global', 'Never use em dashes.');
    const repeat = remember(harness, taskId, 'global', 'never use EM dashes.');
    expect(repeat.events).toEqual([]);
    remember(harness, taskId, 'project', 'Never use em dashes.');
    expect(entries(harness)).toHaveLength(2);
  });

  test('a task outside every project can only propose a global rule', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { repoId: registerRepo(harness, 'scratch', null) });
    expect(() => remember(harness, taskId, 'project', 'Keep plans short.')).toThrow(
      'This task belongs to no project.'
    );
    remember(harness, taskId, 'global', 'Keep plans short.');
    expect(entries(harness)).toHaveLength(1);
  });

  test('an empty rule or one over the limit is refused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(() => remember(harness, taskId, 'global', '   ')).toThrow(
      'Write the rule for agents to remember.'
    );
    expect(() => remember(harness, taskId, 'global', 'x'.repeat(MEMORY_LIMITS.text + 1))).toThrow(
      `A rule can be at most ${MEMORY_LIMITS.text} characters.`
    );
  });

  test('at most ten proposals wait for you at once', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    for (let index = 0; index < MEMORY_LIMITS.proposals; index += 1) {
      remember(harness, taskId, 'global', `Rule ${index}.`);
    }
    expect(() => remember(harness, taskId, 'global', 'One more.')).toThrow(
      'The human already has 10 rules to look at.'
    );
  });

  test('the reviewer cannot propose a rule', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(harness.activeRun(taskId).role).toBe('reviewer');
    expect(() => remember(harness, taskId, 'global', 'Keep plans short.')).toThrow();
    expect(entries(harness)).toEqual([]);
  });
});

describe('what you keep', () => {
  test('keeping a proposal makes it a rule agents follow', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    remember(harness, taskId, 'project', 'Keep plans short.');
    const [proposal] = entries(harness);
    harness.send({ type: 'memory.accept', memoryId: proposal?.id ?? '' });
    expect(listKeptMemory(harness.state, projectOf(harness, taskId))).toMatchObject([
      { id: proposal?.id, status: 'kept', text: 'Keep plans short.' },
    ]);
    expect(harness.send({ type: 'memory.accept', memoryId: proposal?.id ?? '' }).events).toEqual([]);
  });

  test('writing over a proposal keeps it with your words', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    remember(harness, taskId, 'global', 'Keep plans short.');
    const [proposal] = entries(harness);
    write(harness, 'Keep plans to three phases.', null, proposal?.id ?? null);
    expect(entries(harness)).toMatchObject([{ status: 'kept', text: 'Keep plans to three phases.' }]);
  });

  test('you write a rule for every project or for one, and only that project’s agents get it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const projectId = projectOf(harness, taskId);
    write(harness, 'Never use em dashes.');
    write(harness, 'Use bun, not npm.', projectId);
    expect(listKeptMemory(harness.state, projectId).map((entry) => entry.text)).toEqual([
      'Never use em dashes.',
      'Use bun, not npm.',
    ]);
    expect(listKeptMemory(harness.state, null).map((entry) => entry.text)).toEqual(['Never use em dashes.']);
  });

  test('writing the same rule again changes nothing, and a change moves it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    write(harness, 'Never use em dashes.');
    const [entry] = entries(harness);
    expect(write(harness, ' Never use em dashes. ', null, entry?.id ?? null).events).toEqual([]);
    write(harness, 'Never use em dashes.', projectOf(harness, taskId), entry?.id ?? null);
    expect(entries(harness)[0]?.projectId).toBe(projectOf(harness, taskId));
  });

  test('a scope holds at most twenty rules', () => {
    const harness = createHarness();
    for (let index = 0; index < MEMORY_LIMITS.keptPerScope; index += 1) write(harness, `Rule ${index}.`);
    expect(() => write(harness, 'One more.')).toThrow(
      'Agents already remember 20 rules for every project. Remove one first.'
    );
    const taskId = createTask(harness);
    remember(harness, taskId, 'global', 'One more.');
    const proposal = entries(harness).find((entry) => entry.status === 'proposed');
    expect(() => harness.send({ type: 'memory.accept', memoryId: proposal?.id ?? '' })).toThrow(
      'Remove one first.'
    );
    write(harness, 'For the project.', projectOf(harness, taskId));
    for (let index = 1; index < MEMORY_LIMITS.keptPerScope; index += 1) {
      write(harness, `Project rule ${index}.`, projectOf(harness, taskId));
    }
    expect(() => write(harness, 'Another.', projectOf(harness, taskId))).toThrow(
      'Agents already remember 20 rules for this project.'
    );
  });

  test('an empty rule, an unknown rule or an unknown project is refused', () => {
    const harness = createHarness();
    expect(() => write(harness, ' ')).toThrow('Write the rule for agents to remember.');
    expect(() => write(harness, 'A rule.', 'nope')).toThrow('No project nope');
    expect(() => write(harness, 'A rule.', null, 'nope')).toThrow('No memory nope');
    expect(() => harness.send({ type: 'memory.accept', memoryId: 'nope' })).toThrow('No memory nope');
    expect(() => harness.send({ type: 'memory.remove', memoryId: 'nope' })).toThrow('No memory nope');
  });

  test('removing forgets a rule or dismisses a proposal', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    write(harness, 'Never use em dashes.');
    remember(harness, taskId, 'global', 'Keep plans short.');
    for (const entry of entries(harness)) harness.send({ type: 'memory.remove', memoryId: entry.id });
    expect(entries(harness)).toEqual([]);
  });

  test('removing a project forgets its rules and keeps the global ones', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const projectId = projectOf(harness, taskId);
    write(harness, 'Never use em dashes.');
    write(harness, 'Use bun.', projectId);
    harness.send({ type: 'project.remove', projectId });
    expect(entries(harness).map((entry) => entry.text)).toEqual(['Never use em dashes.']);
  });
});

describe('only the human decides what agents remember', () => {
  test('writing, keeping or removing a rule on your behalf is refused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    remember(harness, taskId, 'global', 'Keep plans short.');
    const memoryId = entries(harness)[0]?.id ?? '';
    const refusal = 'Only the human decides what agents remember.';
    expect(() =>
      harness.send({ type: 'memory.write', memoryId: null, projectId: null, text: 'A.' }, { onBehalf: true })
    ).toThrow(refusal);
    expect(() => harness.send({ type: 'memory.accept', memoryId }, { onBehalf: true })).toThrow(refusal);
    expect(() => harness.send({ type: 'memory.remove', memoryId }, { onBehalf: true })).toThrow(refusal);
    expect(entries(harness)).toMatchObject([{ status: 'proposed' }]);
  });
});

describe('what agents are told', () => {
  const HEADING = 'The human asked agents to remember these rules';
  const NEW_HEADING = 'The human kept new rules for agents since your last turn';

  test('a fresh session hears every rule for its project and every global rule, and no other project’s', () => {
    const harness = createHarness();
    harness.send({ type: 'project.write', project: { name: 'Other', color: 'blue', folders: [] } });
    const other = Object.keys(harness.state.projects)[0] ?? '';
    write(harness, 'Never use em dashes.');
    write(harness, 'Only for the other project.', other);
    const taskId = createTask(harness);
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(prompt).toContain(
      `${HEADING} from earlier work. Follow them unless this task asks otherwise:\n- Never use em dashes.`
    );
    expect(prompt).not.toContain('Only for the other project.');
  });

  test('a proposal is never told, and without rules there is no heading', () => {
    const harness = createHarness();
    const first = createTask(harness);
    remember(harness, first, 'global', 'Keep plans short.');
    const second = createTask(harness, { request: 'Add the export' });
    expect(harness.activeRun(second).prompt).not.toContain(HEADING);
  });

  test('a resumed session hears only the rules kept since its last turn', () => {
    const harness = createHarness();
    write(harness, 'Never use em dashes.');
    const taskId = createTask(harness);
    linkSession(harness, taskId);
    write(harness, 'Keep plans short.');
    proposePlan(harness, taskId);
    const build = harness.activeRun(taskId);
    expect(build.resume).toBe(true);
    expect(build.prompt).toContain(
      `${NEW_HEADING}. Follow them from now on unless this task asks otherwise:\n- Keep plans short.`
    );
    expect(build.prompt).not.toContain('Never use em dashes.');
    completePhase(harness, taskId);
    expect(harness.activeRun(taskId).prompt).not.toContain(NEW_HEADING);
  });

  test('a rule you edit is told again to a resumed session', () => {
    const harness = createHarness();
    write(harness, 'Never use em dashes.');
    const [rule] = entries(harness);
    const taskId = createTask(harness);
    linkSession(harness, taskId);
    write(harness, 'Never use em dashes or en dashes.', null, rule?.id ?? null);
    proposePlan(harness, taskId);
    expect(harness.activeRun(taskId).prompt).toContain('- Never use em dashes or en dashes.');
  });

  test('the reviewer hears the rules in its own fresh session', () => {
    const harness = createHarness();
    write(harness, 'Never use em dashes.');
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const reviewer = harness.activeRun(taskId);
    expect(reviewer.role).toBe('reviewer');
    expect(reviewer.prompt).toContain(`${HEADING} from earlier work.`);
  });

  test('a session that comes back fresh after a lost resume is briefed with every rule', () => {
    const harness = createHarness();
    write(harness, 'Never use em dashes.');
    const taskId = createTask(harness);
    linkSession(harness, taskId);
    proposePlan(harness, taskId);
    const build = harness.activeRun(taskId);
    expect(build.prompt).not.toContain('Never use em dashes.');
    expect(resolveRunBrief(harness.state, build)).toContain(`${HEADING} from earlier work.`);
  });

  test('a resumed reviewer that must be briefed again gets every rule', () => {
    const harness = createHarness();
    write(harness, 'Never use em dashes.');
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    linkSession(harness, taskId, 'review-session');
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [{ severity: 'blocking', file: null, line: null, message: 'Handle the empty list.' }],
    });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Handled it.' });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const reviewer = harness.activeRun(taskId);
    expect(reviewer).toMatchObject({ role: 'reviewer', resume: true });
    expect(reviewer.prompt).not.toContain('Never use em dashes.');
    expect(resolveRunBrief(harness.state, reviewer)).toContain(`${HEADING} from earlier work.`);
    const delegated = { ...reviewer, role: 'planner' as const };
    expect(resolveRunBrief(harness.state, delegated)).toBe(reviewer.prompt ?? '');
  });
});
