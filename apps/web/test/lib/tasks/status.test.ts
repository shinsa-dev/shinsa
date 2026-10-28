import { describe, expect, it } from 'bun:test';
import { type Gate, listMergeSteps, type Task } from '@shinsa/core';
import {
  ATTENTION,
  resolveGateGlyph,
  resolveGateStatus,
  resolveRowStatus,
  resolveTaskGlyph,
  resolveTaskMenuIcon,
  resolveTaskStatus,
  resolveTaskStatusIcon,
  resolveWorkingGlyph,
} from '@/lib/tasks/status.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

function gate(overrides: Partial<Gate> = {}) {
  return createGate({ id: 'g', taskId: 't', ...overrides });
}

function withGate(overrides: Partial<Gate>, task: Partial<Task> = {}) {
  const subject = createTask({ id: 't', ...task });
  return { state: createShinsaState({ tasks: [subject], gates: [gate(overrides)] }), task: subject };
}

describe('gate glyphs and statuses', () => {
  it('give each decision its icon, label and tone', () => {
    expect(resolveGateGlyph(gate({ type: 'plan' }))).toEqual({ icon: 'IconFileText', tone: 'purple' });
    expect(resolveGateGlyph(gate({ type: 'review' }))).toEqual({ icon: 'IconEyeOpen', tone: 'amber' });
    expect(resolveGateGlyph(gate({ type: 'merge' }))).toEqual({ icon: 'IconMerged', tone: 'green' });
    expect(resolveGateGlyph(gate({ type: 'question' }))).toEqual({
      icon: 'IconBubbleQuestion',
      tone: 'blue',
    });
    expect(resolveGateStatus(gate({ type: 'plan' }))).toEqual({ label: 'Plan to approve', tone: 'purple' });
    expect(resolveGateStatus(gate({ type: 'review' }))).toEqual({
      label: 'Changes to review',
      tone: 'amber',
    });
    expect(resolveGateStatus(gate({ type: 'merge' }))).toEqual({ label: 'Ready to merge', tone: 'green' });
    expect(resolveGateStatus(gate({ type: 'question' }))).toEqual({
      label: 'Needs your answer',
      tone: 'blue',
    });
  });

  it('show a failure as paused in orange and a secret request as needing your answer', () => {
    expect(resolveGateGlyph(gate({ type: 'failure' }))).toEqual({ icon: 'IconPause', tone: 'orange' });
    expect(resolveGateStatus(gate({ type: 'failure' }))).toEqual({ label: 'Paused', tone: 'orange' });
    expect(resolveGateGlyph(gate({ type: 'secret' })).tone).toBe('blue');
    expect(resolveGateStatus(gate({ type: 'secret' })).label).toBe('Needs your answer');
  });
});

describe('a merged task with steps left', () => {
  it('says how many steps after the merge are left, in amber, until each is ticked', () => {
    const step = {
      when: 'post_merge' as const,
      kind: 'migration' as const,
      title: 'Migrate',
      detail: 'd',
      command: null,
    };
    const walkthrough = {
      approach: 'a',
      flow: 'f',
      risks: [],
      testing: { automated: [], manual: [] },
      steps: [step, { ...step, title: 'Deploy' }],
    };
    const phaseReports = [{ index: 0, summary: 's', spots: [], judgementCalls: [], walkthrough, at: 0 }];
    const pullRequest = createPullRequest({ number: 42, state: 'merged' });
    const task = createTask({ id: 't', stage: 'merged', phaseReports, pullRequest });
    const open = createShinsaState({ tasks: [task], gates: [gate({ type: 'post_merge' })] });
    expect(resolveTaskStatus(open, task)).toEqual({ label: 'Post-merge · 2 steps left', tone: 'amber' });
    expect(resolveTaskStatusIcon(open, task)).toBe('IconChecklist');
    expect(resolveGateStatus(gate({ type: 'post_merge' }))).toEqual({
      label: 'Post-merge',
      tone: 'amber',
    });
    expect(resolveTaskStatus(createShinsaState({ tasks: [task] }), task)).toEqual({
      label: 'Merged',
      tone: 'neutral',
    });
  });
});

describe('a merge gate with steps before it', () => {
  it('says how many steps before the merge are left, in amber, then that it is ready', () => {
    const step = {
      when: 'pre_merge' as const,
      kind: 'env' as const,
      title: 'Set A',
      detail: 'd',
      command: null,
    };
    const walkthrough = {
      approach: 'a',
      flow: 'f',
      risks: [],
      testing: { automated: [], manual: [] },
      steps: [step],
    };
    const phaseReports = [{ index: 0, summary: 's', spots: [], judgementCalls: [], walkthrough, at: 0 }];
    const { state, task } = withGate({ type: 'merge' }, { stage: 'awaiting_merge', phaseReports });
    expect(resolveTaskStatus(state, task)).toEqual({
      label: 'Pre-merge · 1 step left',
      tone: 'amber',
    });
    const ticked = { ...task, mergeStepsDone: listMergeSteps(task).map((candidate) => candidate.key) };
    expect(resolveTaskStatus(state, ticked)).toEqual({ label: 'Ready to merge', tone: 'green' });
  });
});

describe('a proposed change', () => {
  it('is a purple decision to approve, like a plan', () => {
    expect(resolveGateGlyph(gate({ type: 'proposal' }))).toEqual({ icon: 'IconFileEdit', tone: 'purple' });
    const { state, task } = withGate({ type: 'proposal' }, { stage: 'awaiting_proposal' });
    expect(resolveTaskStatus(state, task)).toEqual({ label: 'Change to approve', tone: 'purple' });
    expect(resolveTaskGlyph(state, task)).toEqual({ icon: 'IconFileEdit', tone: 'purple' });
  });

  it('shows a merged change waiting for your OK on its operation as a purple decision', () => {
    expect(resolveGateGlyph(gate({ type: 'operation' }))).toEqual({
      icon: 'IconConsole',
      tone: 'purple',
    });
    const { state, task } = withGate({ type: 'operation' }, { stage: 'awaiting_operation' });
    expect(resolveTaskStatus(state, task)).toEqual({ label: 'Operation to confirm', tone: 'purple' });
    expect(resolveTaskGlyph(state, task)).toEqual({ icon: 'IconConsole', tone: 'purple' });
  });

  it('shows investigating, researching and running an operation as blue work with their own icons', () => {
    const state = createShinsaState({});
    for (const [stage, label, icon] of [
      ['investigating', 'Investigating', 'IconMagnifyingGlass'],
      ['researching', 'Researching', 'IconBook'],
      ['operating', 'Running the operation', 'IconConsole'],
    ] as const) {
      const task = createTask({ id: stage, stage });
      expect(resolveTaskStatus(state, task)).toEqual({ label, tone: 'blue' });
      expect(resolveTaskGlyph(state, task)).toEqual({ icon, tone: 'blue' });
    }
  });
});

describe('resolveTaskStatus', () => {
  it('show a setup gate as setup incomplete in orange, in the paused group', () => {
    const setup = gate({ type: 'configuration' });
    expect(resolveGateGlyph(setup)).toEqual({ icon: 'IconToolbox', tone: 'orange' });
    expect(resolveGateStatus(setup)).toEqual({ label: 'Setup incomplete', tone: 'orange' });
    const { state, task } = withGate({ type: 'configuration' });
    expect(resolveTaskGlyph(state, task)).toEqual({ icon: 'IconToolbox', tone: 'orange' });
  });

  it('says a task whose agent is waiting to check in again is waiting, not building', () => {
    const task = createTask({
      id: 't',
      monitor: {
        id: 'm',
        runId: 'r',
        role: 'agent',
        phaseIndex: 0,
        notes: 'n',
        armedAt: 0,
        nextCheckAt: 1,
        timeoutAt: 2,
        attempts: 0,
        maxAttempts: 1,
        status: 'armed',
      },
    });
    expect(resolveTaskStatus(createShinsaState({ tasks: [task] }), task)).toEqual({
      label: 'Waiting to check in again',
      tone: 'blue',
    });
  });

  it('names the stage in a queue row while the agent waits to check in, and the status otherwise', () => {
    const monitor = {
      id: 'm',
      runId: 'r',
      role: 'agent' as const,
      phaseIndex: 0,
      notes: 'n',
      armedAt: 0,
      nextCheckAt: 1,
      timeoutAt: 2,
      attempts: 0,
      maxAttempts: 1,
      status: 'armed' as const,
    };
    const waiting = createTask({ id: 't', stage: 'building', monitor });
    expect(resolveRowStatus(createShinsaState({ tasks: [waiting] }), waiting)).toEqual({
      label: 'Building',
      tone: 'blue',
    });
    const { state, task } = withGate({ type: 'review' });
    expect(resolveRowStatus(state, task)).toEqual(resolveGateStatus(gate({ type: 'review' })));
  });

  it('shows a sign-in gate as sign in needed in orange, in the paused group', () => {
    const signIn = gate({ type: 'sign_in' });
    expect(resolveGateGlyph(signIn)).toEqual({ icon: 'IconUserKey', tone: 'orange' });
    expect(resolveGateStatus(signIn)).toEqual({ label: 'Sign in needed', tone: 'orange' });
    const { state, task } = withGate({ type: 'sign_in' });
    expect(resolveTaskStatus(state, task)).toEqual({ label: 'Sign in needed', tone: 'orange' });
    expect(resolveTaskGlyph(state, task)).toEqual({ icon: 'IconUserKey', tone: 'orange' });
  });

  it('says a task whose step waits for the work it delegated is waiting for it, in blue', () => {
    const task = createTask({ id: 't', stage: 'building' });
    const step = createRun({
      id: 'r',
      taskId: 't',
      status: 'waiting',
      waitingOn: { delegations: ['child'], since: 1, reason: 'Waiting for the survey.' },
    });
    expect(resolveTaskStatus(createShinsaState({ tasks: [task], runs: [step] }), task)).toEqual({
      label: 'Waiting for delegations',
      tone: 'blue',
    });
    const working = createRun({ id: 'r', taskId: 't', status: 'running' });
    expect(resolveTaskStatus(createShinsaState({ tasks: [task], runs: [working] }), task).label).toBe(
      'Building'
    );
  });

  it('says a task held at the usage limit is waiting for it, in blue', () => {
    const task = createTask({
      id: 't',
      usageWait: {
        id: 'w',
        runId: 'r',
        role: 'agent',
        phaseIndex: 0,
        account: null,
        resetAt: 2,
        armedAt: 1,
        autoResume: true,
        status: 'armed',
      },
    });
    expect(resolveTaskStatus(createShinsaState({ tasks: [task] }), task)).toEqual({
      label: 'Waiting for the usage limit',
      tone: 'blue',
    });
  });

  it('reads the lead gate first', () => {
    const { state, task } = withGate({ type: 'merge' });
    expect(resolveTaskStatus(state, task)).toEqual({ label: 'Ready to merge', tone: 'green' });
  });

  it('says not started in neutral for a task waiting to start on another task', () => {
    const base = createTask({ id: 'base' });
    const task = createTask({ id: 't', stage: 'waiting_on_tasks', waitsOn: ['base'] });
    expect(resolveTaskStatus(createShinsaState({ tasks: [base, task] }), task)).toEqual({
      label: 'Not started',
      tone: 'neutral',
    });
  });

  it('does not call a task with an open pull request not started while it waits to merge', () => {
    const base = createTask({ id: 'base' });
    const task = createTask({ id: 't', stage: 'shipping', waitsOn: ['base'] });
    expect(resolveTaskStatus(createShinsaState({ tasks: [base, task] }), task)).toEqual({
      label: 'Waiting on another task',
      tone: 'neutral',
    });
  });

  it('falls back to the stage label and tone', () => {
    const task = createTask({ id: 't', stage: 'building' });
    expect(resolveTaskStatus(createShinsaState({ tasks: [task] }), task)).toEqual({
      label: 'Building',
      tone: 'blue',
    });
    const merged = createTask({ id: 'm', stage: 'merged' });
    expect(resolveTaskStatus(createShinsaState({ tasks: [merged] }), merged).label).toBe('Merged');
  });
});

describe('resolveTaskStatusIcon', () => {
  const ARMED = { runId: 'r', role: 'agent' as const, phaseIndex: 0, armedAt: 0, status: 'armed' as const };

  function iconOf(overrides: Partial<Task>) {
    const task = createTask({ id: 't', ...overrides });
    return resolveTaskStatusIcon(createShinsaState({ tasks: [task, createTask({ id: 'base' })] }), task);
  }

  it('gives a gate’s status the gate’s icon', () => {
    const { state, task } = withGate({ type: 'review' });
    expect(resolveTaskStatusIcon(state, task)).toBe('IconEyeOpen');
  });

  it('gives each wait its own icon', () => {
    const monitor = {
      ...ARMED,
      id: 'm',
      notes: 'n',
      nextCheckAt: 1,
      timeoutAt: 2,
      attempts: 0,
      maxAttempts: 1,
    };
    expect(iconOf({ monitor })).toBe('IconClockSnooze');
    expect(iconOf({ usageWait: { ...ARMED, id: 'w', account: null, resetAt: 2, autoResume: true } })).toBe(
      'IconGauge'
    );
    expect(iconOf({ stage: 'shipping', waitsOn: ['base'] })).toBe('IconHourglass');
    const task = createTask({ id: 't', stage: 'building' });
    const step = createRun({
      id: 'r',
      taskId: 't',
      status: 'waiting',
      waitingOn: { delegations: ['child'], since: 1, reason: 'Waiting for the survey.' },
    });
    expect(resolveTaskStatusIcon(createShinsaState({ tasks: [task], runs: [step] }), task)).toBe(
      'IconAgents'
    );
  });

  it('gives every stage an icon, and a gate’s stage the gate’s icon', () => {
    expect(iconOf({ stage: 'building' })).toBe('IconHammer');
    expect(iconOf({ stage: 'reviewing' })).toBe('IconEyeSparkle');
    expect(iconOf({ stage: 'awaiting_plan' })).toBe('IconFileText');
    expect(iconOf({ stage: 'done' })).toBe('IconCheckCircle2');
    expect(iconOf({ stage: 'cancelled' })).toBe('IconCircleX');
  });
});

describe('resolveTaskGlyph', () => {
  it('uses the stage icon while agents work, and the robot when the stage has none', () => {
    const building = createTask({ id: 'b', stage: 'building' });
    const fixing = createTask({ id: 'f', stage: 'fixing' });
    const state = createShinsaState({ tasks: [building, fixing] });
    expect(resolveTaskGlyph(state, building)).toEqual({ icon: 'IconHammer', tone: 'blue' });
    expect(resolveTaskGlyph(state, fixing)).toEqual({ icon: 'IconRobot', tone: 'blue' });
  });

  it('marks merged tasks with the merge icon and other settled tasks with their section icon', () => {
    const merged = createTask({ id: 'm', stage: 'merged' });
    const done = createTask({ id: 'd', stage: 'done' });
    const cancelled = createTask({ id: 'c', stage: 'cancelled' });
    const state = createShinsaState({ tasks: [merged, done, cancelled] });
    expect(resolveTaskGlyph(state, merged)).toEqual({ icon: 'IconMerged', tone: 'purple' });
    expect(resolveTaskGlyph(state, done)).toEqual({ icon: 'IconCheckCircle2', tone: 'purple' });
    expect(resolveTaskGlyph(state, cancelled)).toEqual({ icon: 'IconCircleX', tone: 'neutral' });
  });

  it('shows the section glyph for decisions and waiting tasks', () => {
    const { state, task } = withGate({ type: 'failure' });
    expect(resolveTaskGlyph(state, task)).toEqual({ icon: 'IconPause', tone: 'orange' });
    const base = createTask({ id: 'base' });
    const waiter = createTask({ id: 'w', stage: 'waiting_on_tasks', waitsOn: ['base'] });
    expect(resolveTaskGlyph(createShinsaState({ tasks: [base, waiter] }), waiter)).toEqual({
      icon: 'IconHourglass',
      tone: 'neutral',
    });
  });
});

describe('resolveWorkingGlyph', () => {
  it('is always blue, with the stage icon or the robot', () => {
    expect(resolveWorkingGlyph(createTask({ id: 'p', stage: 'planning' }))).toEqual({
      icon: 'IconLightbulbGlow',
      tone: 'blue',
    });
    expect(resolveWorkingGlyph(createTask({ id: 'r', stage: 'reviewing' }))).toEqual({
      icon: 'IconRobot',
      tone: 'blue',
    });
  });
});

describe('resolveTaskMenuIcon', () => {
  it('colours the task glyph with its tone for menus', () => {
    const { state, task } = withGate({ type: 'review' });
    expect(resolveTaskMenuIcon(state, task)).toEqual({
      name: 'IconEyeOpen',
      className: 'text-amber-text',
    });
  });
});

describe('ATTENTION', () => {
  it('labels each attention level for review', () => {
    expect(ATTENTION.critical).toEqual({ label: 'Critical', tone: 'red' });
    expect(ATTENTION.high).toEqual({ label: 'Read carefully', tone: 'amber' });
    expect(ATTENTION.normal).toEqual({ label: 'Context', tone: 'neutral' });
  });
});
