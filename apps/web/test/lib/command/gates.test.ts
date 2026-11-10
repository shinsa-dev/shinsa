import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { type Gate, resolveMergeStepKey, type Task } from '@shinsa/core';
import { listOpenGateCommands } from '@/lib/command/gates.ts';
import type { Command } from '@/lib/command/registry.ts';
import * as accounts from '@/lib/connection/accounts.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

const CONTEXT = { comments: [], clearComments: () => {}, verdicts: {}, tab: null };

function commandsFor(task: Task, gate: Gate) {
  return listOpenGateCommands(createShinsaState({ tasks: [task], gates: [gate] }), task, CONTEXT);
}

function run(command: Command | undefined) {
  if (command?.kind !== 'run') throw new Error('not a run command');
  command.run();
}

describe('gate commands', () => {
  it('holds the merge command while a step before the merge is open, saying why', () => {
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
    const report = { index: 0, summary: 's', spots: [], judgementCalls: [], walkthrough, at: 0 };
    const gate = createGate({ id: 'g', taskId: 't', type: 'merge' });
    const open = commandsFor(createTask({ id: 't', phaseReports: [report] }), gate);
    expect(open[0]?.disabled).toBe('Tick the pre-merge step first');
    const ticked = commandsFor(
      createTask({ id: 't', phaseReports: [report], mergeStepsDone: [resolveMergeStepKey(step)] }),
      gate
    );
    expect(ticked[0]?.disabled).toBeUndefined();
    run(ticked[0]);
    expect(spies.sent).toHaveBeenCalled();
  });

  it('ticks each open step after the merge from the gate after it', () => {
    const step = {
      when: 'post_merge' as const,
      kind: 'deploy' as const,
      title: 'Restart',
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
    const report = { index: 0, summary: 's', spots: [], judgementCalls: [], walkthrough, at: 0 };
    const pullRequest = createPullRequest({ number: 42, state: 'merged' });
    const task = createTask({ id: 't', stage: 'merged', phaseReports: [report], pullRequest });
    const commands = commandsFor(task, createGate({ id: 'g', taskId: 't', type: 'post_merge' }));
    expect(commands.map((command) => command.label)).toEqual(['Tick “Restart”']);
    run(commands[0]);
    expect(spies.sent).toHaveBeenCalledWith({
      type: 'merge_step.tick',
      taskId: 't',
      key: resolveMergeStepKey(step),
      done: true,
    });
  });

  it('closes an answered task from the menu', () => {
    const task = createTask({ id: 't', stage: 'answered' });
    const commands = commandsFor(
      task,
      createGate({ id: 'g', taskId: 't', type: 'result', title: 'Read the answer' })
    );
    expect(commands.map((command) => command.label)).toEqual(['Close']);
    run(commands[0]);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null },
      'Closed. The task is done.'
    );
  });

  it('keeps the commands of two open questions on one task apart, each answering its own gate', () => {
    const task = createTask({ id: 't' });
    const gates = ['g1', 'g2'].map((id) =>
      createGate({ id, taskId: 't', type: 'question', choices: ['Yes'] })
    );
    const commands = listOpenGateCommands(createShinsaState({ tasks: [task], gates }), task, CONTEXT);
    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length);
    for (const command of commands) if (command.kind === 'run') command.run();
    expect(spies.sent.mock.calls.map(([command]) => 'gateId' in command && command.gateId)).toEqual([
      'g1',
      'g2',
    ]);
  });

  it('on a review with findings offers what the card offers: fix the blocking ones, with your verdicts', () => {
    const task = createTask({
      id: 't',
      stage: 'awaiting_review',
      findings: [
        { severity: 'blocking', file: 'src/a.ts', line: 3, message: 'Off by one.' },
        { severity: 'optional', file: null, line: null, message: 'Rename it.' },
      ],
    });
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'review',
      escalation: { reason: 'rounds', rounds: 2, at: 1 },
    });
    const decide = commandsFor(task, gate)[0];
    expect([decide?.label, decide?.hint]).toEqual([
      'Fix 1 finding',
      'Sends the findings you kept to the agent',
    ]);
    run(decide);
    expect(spies.sent).toHaveBeenCalledWith(
      {
        type: 'gate.answer',
        gateId: 'g',
        decision: 'revise',
        response: null,
        verdicts: [
          { index: 0, verdict: 'fix', note: null },
          { index: 1, verdict: 'dismiss', note: null },
        ],
      },
      'Sent. The agent works on what you kept.'
    );
  });

  function fixChoices(thenApprove?: boolean, verdicts: Record<number, 'fix' | 'dismiss'> = {}) {
    const task = createTask({
      id: 't',
      stage: 'awaiting_review',
      findings: [{ severity: 'blocking', file: 'src/a.ts', line: 3, message: 'Off by one.' }],
    });
    const gate = createGate({ id: 'g', taskId: 't', type: 'review' });
    const context = { ...CONTEXT, verdicts, ...(thenApprove === undefined ? {} : { thenApprove }) };
    return listOpenGateCommands(createShinsaState({ tasks: [task], gates: [gate] }), task, context);
  }

  it('offers fixing then approving beside the fix you chose, when the engine can', () => {
    const plain = fixChoices(false);
    expect(plain.slice(0, 2).map((command) => [command.id, command.label])).toEqual([
      ['task.t.gate.g.approve', 'Fix 1 finding'],
      ['task.t.gate.g.fix_choice', 'Fix 1 finding and approve'],
    ]);
    run(plain[1]);
    expect(spies.sent).toHaveBeenLastCalledWith(
      {
        type: 'gate.answer',
        gateId: 'g',
        decision: 'revise',
        response: null,
        verdicts: [{ index: 0, verdict: 'fix', note: null }],
        thenApprove: true,
      },
      'Sent. Approving once the fix passes.'
    );
    const chosen = fixChoices(true);
    expect(chosen.slice(0, 2).map((command) => [command.label, command.icon])).toEqual([
      ['Fix 1 finding and approve', 'IconCheckmark1'],
      ['Fix 1 finding', 'IconPencil'],
    ]);
  });

  it('offers no second fix when the engine cannot approve after a fix or nothing is kept to fix', () => {
    expect(fixChoices().map((command) => command.id)).not.toContain('task.t.gate.g.fix_choice');
    expect(fixChoices(false, { 0: 'dismiss' }).map((command) => command.id)).not.toContain(
      'task.t.gate.g.fix_choice'
    );
  });

  it('Fix 1 finding from the menu sends the drafted line comments too and clears them once sent', async () => {
    const task = createTask({
      id: 't',
      stage: 'awaiting_review',
      findings: [{ severity: 'blocking', file: 'src/a.ts', line: 3, message: 'Off by one.' }],
    });
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'review',
      escalation: { reason: 'rounds', rounds: 2, at: 1 },
    });
    let cleared = 0;
    const context = {
      comments: [
        {
          id: 'c1',
          ref: null,
          path: 'src/a.ts',
          side: 'new' as const,
          line: 4,
          endLine: null,
          text: 'Keep the guard.',
        },
      ],
      clearComments: () => {
        cleared += 1;
      },
      verdicts: {},
      tab: null,
    };
    const decide = listOpenGateCommands(
      createShinsaState({ tasks: [task], gates: [gate] }),
      task,
      context
    )[0];
    expect([decide?.label, decide?.hint, decide?.disabled]).toEqual([
      'Fix 1 finding',
      'Sends the findings you kept and your line comments to the agent',
      undefined,
    ]);
    run(decide);
    expect(spies.sent).toHaveBeenCalledWith(
      {
        type: 'gate.answer',
        gateId: 'g',
        decision: 'revise',
        response: null,
        verdicts: [{ index: 0, verdict: 'fix', note: null }],
        comments: [
          {
            path: 'src/a.ts',
            side: 'new',
            line: 4,
            endLine: null,
            text: 'Keep the guard.',
          },
        ],
      },
      'Sent. The agent works on what you kept.'
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(cleared).toBe(1);
  });

  it('answers each choice of a question in one step, the recommended one marked', () => {
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'question',
      choices: ['Blue', 'Green'],
      recommendation: 'Green',
    });
    const commands = commandsFor(createTask({ id: 't' }), gate);
    expect(commands.map((command) => [command.label, command.hint])).toEqual([
      ['Answer “Blue”', undefined],
      ['Answer “Green”', 'Recommended'],
      ['Answer the question', gate.title],
    ]);
    run(commands[1]);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'gate.answer', gateId: 'g', decision: 'reply', response: 'Green' },
      'Answered. The agent carries on.'
    );
  });

  it('makes a proposed change, or keeps the task as the inquiry it was', () => {
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'proposal',
      title: 'Turn this investigation into a fix?',
    });
    const commands = commandsFor(createTask({ id: 't', pipeline: ['investigate'] }), gate);
    expect(commands.map((command) => [command.label, command.icon])).toEqual([
      ['Make it a change', 'IconFileEdit'],
      ['Keep it as an investigation', 'IconCheckCircle2'],
    ]);
    run(commands[0]);
    run(commands[1]);
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null },
        'Approved. Planning the change now.',
      ],
      [
        { type: 'gate.answer', gateId: 'g', decision: 'reject', response: null },
        'Kept as it is. The task is done.',
      ],
    ]);
  });

  it('offers Start N tasks and Keep as one task on a plan with a split', () => {
    const gate = createGate({ id: 'g', taskId: 't', type: 'plan' });
    const task = createTask({
      id: 't',
      stage: 'awaiting_plan',
      plan: {
        version: 2,
        body: '',
        proposedAt: 0,
        document: {
          goal: 'g',
          phases: [],
          behaviour: [],
          approach: '',
          files: [],
          outOfScope: [],
          verification: [],
          questions: [],
          split: [{ title: 'A', request: 'a', order: 'parallel' }],
        },
      },
    });
    const commands = commandsFor(task, gate);
    expect(commands.map((command) => [command.id, command.label])).toEqual([
      ['task.t.gate.g.approve', 'Start 2 tasks'],
      ['task.t.gate.g.keep-one-task', 'Keep as one task'],
      ['task.t.gate.g.revise', 'Revise the plan'],
    ]);
    run(commands[0]);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null, planVersion: 2 },
      'Approved. Building now.'
    );
    run(commands[1]);
    expect(spies.sent).toHaveBeenCalledWith(
      {
        type: 'gate.answer',
        gateId: 'g',
        decision: 'revise',
        response: 'Keep this as one task: drop the split and plan all of the work here.',
      },
      'Sent back as one task.'
    );
  });

  it('offers Start N-task bundle on a plan whose parts stack on this task', () => {
    const gate = createGate({ id: 'g', taskId: 't', type: 'plan' });
    const task = createTask({
      id: 't',
      stage: 'awaiting_plan',
      plan: {
        version: 1,
        body: '',
        proposedAt: 0,
        document: {
          goal: 'g',
          phases: [],
          behaviour: [],
          approach: '',
          files: [],
          outOfScope: [],
          verification: [],
          questions: [],
          split: [{ title: 'A', request: 'a', order: 'stacks_on', on: 0 }],
        },
      },
    });
    const approve = commandsFor(task, gate)[0];
    expect(approve?.label).toBe('Start 2-task bundle');
    expect(approve?.keywords).toContain('bundle');
  });

  it('offers only Approve the plan and Revise on a plan without a split', () => {
    const gate = createGate({ id: 'g', taskId: 't', type: 'plan' });
    const task = createTask({ id: 't', stage: 'awaiting_plan' });
    expect(commandsFor(task, gate).map((command) => command.label)).toEqual([
      'Approve the plan',
      'Revise the plan',
    ]);
  });

  it('leads with Close when the agent recommends closing a proposal', () => {
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'proposal',
      title: 'The diagnosis found nothing to fix',
    });
    const task = createTask({
      id: 't',
      pipeline: ['investigate', 'your_ok', 'plan', 'build', 'merge'],
      stage: 'awaiting_proposal',
      proposal: { request: 'r', why: 'w', status: 'open', recommend: 'close', runId: null, at: 0 },
    });
    const commands = commandsFor(task, gate);
    expect(commands.map((command) => [command.id, command.label, command.hint])).toEqual([
      ['task.t.gate.g.closeProposal', 'Close', 'The diagnosis found nothing to fix'],
      ['task.t.gate.g.makeChange', 'Make it a change', undefined],
    ]);
    run(commands[0]);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'gate.answer', gateId: 'g', decision: 'reject', response: null },
      'Closed. The task is done.'
    );
  });

  it('lists the agent’s suggested replies after a gate that takes a message, and none after a question', () => {
    const suggestedActions = [
      { label: 'Do the renames', message: 'Do the renames too.' },
      { label: 'Skip them', message: 'Leave the names as they are.' },
    ];
    const task = createTask({ id: 't', stage: 'awaiting_review', suggestedActions });
    const review = commandsFor(task, createGate({ id: 'g', taskId: 't', type: 'review' }));
    expect(
      review
        .filter((command) => command.hint === 'Suggested reply')
        .map((command) => [command.id, command.label])
    ).toEqual([
      ['task.t.suggested.0', 'Do the renames'],
      ['task.t.suggested.1', 'Skip them'],
    ]);
    run(review.find((command) => command.id === 'task.t.suggested.0'));
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'task.message', taskId: 't', text: 'Do the renames too.' },
      'Changes requested.'
    );
    const question = commandsFor(
      createTask({ id: 't', stage: 'building', suggestedActions }),
      createGate({ id: 'g', taskId: 't', type: 'question' })
    );
    expect(question.some((command) => command.hint === 'Suggested reply')).toBe(false);
  });

  it('runs the operation after the merge with the saved notes, or finishes without it after a confirm', () => {
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'operation',
      title: 'The change merged. Run the operation now?',
    });
    const commands = commandsFor(createTask({ id: 't', stage: 'awaiting_operation' }), gate);
    expect(commands.map((command) => [command.label, command.icon, command.hint])).toEqual([
      ['Run the operation', 'IconConsole', 'The change merged. Run the operation now?'],
      ['Finish without it', 'IconCheckCircle2', undefined],
    ]);
    run(commands[0]);
    const [, skip] = commands;
    if (skip?.kind !== 'page' || skip.page.kind !== 'list') throw new Error('Expected a confirm list');
    expect(skip.destructive).toBe(true);
    expect(skip.page.placeholder).toBe('Finish without running the operation?');
    const [keep, confirm] = [...(skip.page.sections[0]?.commands ?? [])].reverse();
    run(keep);
    expect(spies.sent).toHaveBeenCalledTimes(1);
    run(confirm);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'gate.answer', gateId: 'g', decision: 'approve', response: null }, 'Running the operation.'],
      [
        { type: 'gate.answer', gateId: 'g', decision: 'reject', response: null },
        'Finished without running the operation.',
      ],
    ]);
  });

  it('verifies the setup again, and never offers to start without checks', () => {
    const gate = createGate({ id: 'g', taskId: 't', type: 'configuration' });
    const branch = createTask({ id: 't', configProblems: [{ kind: 'default_branch', detail: 'Gone.' }] });
    const commands = commandsFor(branch, gate);
    expect(commands.map((command) => [command.label, command.icon])).toEqual([
      ['Verify the setup again', 'IconToolbox'],
    ]);
    run(commands[0]);
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null },
        'Verifying the setup again.',
      ],
    ]);
  });

  it('offers each repository the setup question lists instead of verifying again', () => {
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'configuration',
      title: 'Which repository is this task for?',
      choices: ['shinsa', 'paywall-next'],
    });
    const commands = commandsFor(createTask({ id: 't' }), gate);
    expect(commands.map((command) => [command.label, command.hint, command.icon])).toEqual([
      ['Use shinsa', 'Which repository is this task for?', 'IconToolbox'],
      ['Use paywall-next', 'Which repository is this task for?', 'IconToolbox'],
    ]);
    run(commands[1]);
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'gate.answer', gateId: 'g', decision: 'reply', response: 'paywall-next' },
        'Checking that repository.',
      ],
    ]);
  });

  it('signs in to the gate’s account, with the sign-in glyph, or retries anyway', () => {
    const signIn = spyOn(accounts, 'startSignIn').mockResolvedValue(undefined);
    const task = createTask({ id: 't' });
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'sign_in',
      title: 'Paused: a@example.com needs signing in',
      provider: 'claude',
      account: { id: 'a', email: 'a@example.com' },
    });
    const [signInCommand, retry] = commandsFor(task, gate);
    expect(signInCommand).toMatchObject({
      label: 'Sign in',
      hint: 'Paused: a@example.com needs signing in',
      icon: 'IconUserKey',
    });
    run(signInCommand);
    run(retry);
    run(commandsFor(task, { ...gate, account: null })[0]);
    expect(signIn.mock.calls).toEqual([['a'], [null]]);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'gate.answer', gateId: 'g', decision: 'approve', response: null }, 'Picking it up again.'],
    ] as never);
    signIn.mockRestore();
  });

  it('a provider with its own sign-in is checked again instead of signed in from Shinsa', () => {
    const refresh = spyOn(accounts, 'refreshUsage').mockResolvedValue(true);
    const task = createTask({ id: 't' });
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'sign_in',
      title: 'Paused: codex@example.com needs signing in',
      provider: 'codex',
      account: null,
    });
    const [check] = commandsFor(task, gate);
    expect(check).toMatchObject({ label: 'Check the Codex sign-in again', hint: gate.title });
    run(check);
    expect(refresh).toHaveBeenCalledTimes(1);
    refresh.mockRestore();
  });
});
