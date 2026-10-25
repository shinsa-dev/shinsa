import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { Gate, Task } from '@shinsa/core';
import { listOpenGateCommands } from '@/lib/command/gates.ts';
import type { Command } from '@/lib/command/registry.ts';
import * as accounts from '@/lib/connection/accounts.ts';
import { spyOnCommands } from '../../support/commands.ts';
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
        { severity: 'suggestion', file: null, line: null, message: 'Rename it.' },
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

  it('verifies the setup again, and waives the checks only when checks are all that is missing', () => {
    const gate = createGate({ id: 'g', taskId: 't', type: 'configuration' });
    const checks = createTask({ id: 't', configProblems: [{ kind: 'check_commands', detail: 'None.' }] });
    const branch = createTask({ id: 't', configProblems: [{ kind: 'default_branch', detail: 'Gone.' }] });
    expect(commandsFor(branch, gate).map((command) => command.label)).toEqual(['Verify the setup again']);
    const commands = commandsFor(checks, gate);
    expect(commands.map((command) => [command.label, command.icon])).toEqual([
      ['Verify the setup again', 'IconToolbox'],
      ['Start without checks', 'IconShieldCheck'],
    ]);
    run(commands[0]);
    run(commands[1]);
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null },
        'Verifying the setup again.',
      ],
      [
        { type: 'gate.answer', gateId: 'g', decision: 'waive', response: null },
        'Starting without checks for this repository.',
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
      title: 'Sign in to Claude as a@example.com',
      provider: 'claude',
      account: { id: 'a', email: 'a@example.com' },
    });
    const [signInCommand, retry] = commandsFor(task, gate);
    expect(signInCommand).toMatchObject({
      label: 'Sign in',
      hint: 'Sign in to Claude as a@example.com',
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
      title: 'Sign in to Codex as codex@example.com',
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
