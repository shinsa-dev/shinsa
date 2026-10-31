import { describe, expect, it, spyOn } from 'bun:test';
import type { UsageWait } from '@shinsa/core';
import {
  listAccountBindingCommands,
  listAccountSections,
  listRerunCommands,
  listUsageWaitCommands,
} from '@/lib/command/accounts.ts';
import type { Command } from '@/lib/command/registry.ts';
import * as settingsCommands from '@/lib/command/settings.ts';
import * as accounts from '@/lib/connection/accounts.ts';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

function run(command: Command | undefined) {
  if (command?.kind !== 'run') throw new Error('Not a run command');
  command.run();
}

function pick(command: Command | undefined, value: string) {
  if (command?.kind !== 'choice') throw new Error('Not a choice');
  command.pick(value);
}

const WAIT: UsageWait = {
  id: 'w1',
  runId: 'r1',
  role: 'agent',
  phaseIndex: 0,
  account: null,
  resetAt: NOW + 60_000,
  armedAt: NOW,
  autoResume: true,
  status: 'armed',
};

describe('the global Accounts group', () => {
  it('adds an account and opens Agent usage in Settings, even before any account exists', () => {
    const signIn = spyOn(accounts, 'startSignIn').mockResolvedValue(undefined);
    const open = spyOn(settingsCommands, 'openSettingsSection').mockReturnValue(undefined);
    const [section] = listAccountSections(null);
    expect(section?.heading).toBe('Accounts');
    expect(section?.commands.map((command) => command.label)).toEqual([
      'Add a Claude account',
      'Agent usage',
    ]);
    run(section?.commands[0]);
    run(section?.commands[1]);
    expect(signIn).toHaveBeenCalledWith();
    expect(open).toHaveBeenCalledWith('Accounts');
    signIn.mockRestore();
    open.mockRestore();
  });

  it('picks the default account from every account', () => {
    const update = spyOn(accounts, 'updateAccount').mockResolvedValue(true);
    const snapshot = createSnapshot({
      accounts: [createAccount({ id: 'a', isDefault: true }), createAccount({ id: 'b', plan: null })],
    });
    const choice = listAccountSections(snapshot)[0]?.commands[2];
    expect(choice).toMatchObject({
      label: 'Default account',
      heading: 'Set as default',
      hint: 'a@example.com',
      value: 'a',
    });
    pick(choice, 'b');
    pick(choice, 'gone');
    expect(update.mock.calls).toEqual([['b', { isDefault: true }, 'b@example.com is the default.']]);
    const noDefault = listAccountSections(createSnapshot({ accounts: [createAccount({ id: 'b' })] }))[0];
    expect(noDefault?.commands[2]).toMatchObject({ value: null });
    expect(noDefault?.commands[2]?.hint).toBeUndefined();
    update.mockRestore();
  });
});

describe('usage waits', () => {
  it('resumes now or changes whether it resumes by itself', () => {
    const resume = spyOn(accounts, 'resumeUsageWaitNow').mockResolvedValue(true);
    const change = spyOn(accounts, 'updateUsageWait').mockResolvedValue(true);
    const waiting = createTask({ id: 't', usageWait: WAIT });
    const [now, toggle] = listUsageWaitCommands(waiting);
    expect(toggle).toMatchObject({ label: 'Don’t resume automatically', icon: 'IconPause' });
    run(now);
    run(toggle);
    const paused = listUsageWaitCommands(createTask({ id: 't', usageWait: { ...WAIT, autoResume: false } }));
    expect(paused[1]).toMatchObject({ label: 'Resume at the reset', icon: 'IconHourglass' });
    run(paused[1]);
    expect(resume).toHaveBeenCalledWith('t');
    expect(change.mock.calls).toEqual([
      ['t', false],
      ['t', true],
    ]);
    expect(listUsageWaitCommands(createTask({ id: 't' }))).toEqual([]);
    resume.mockRestore();
    change.mockRestore();
  });
});

describe('Run on account', () => {
  it('binds the task to the account you pick', () => {
    const bind = spyOn(accounts, 'bindTaskAccount').mockResolvedValue(true);
    const snapshot = createSnapshot({ accounts: [createAccount({ id: 'a' })] });
    const [choice] = listAccountBindingCommands(snapshot, createTask({ id: 't' }));
    expect(choice).toMatchObject({ label: 'Run on account…', hint: 'Any account', value: 'any' });
    pick(choice, 'a');
    pick(choice, 'any');
    expect(bind.mock.calls).toEqual([
      ['t', { id: 'a', email: 'a@example.com' }],
      ['t', null],
    ]);
    bind.mockRestore();
  });

  it('is left out without accounts and on finished tasks', () => {
    const snapshot = createSnapshot({ accounts: [createAccount({ id: 'a' })] });
    expect(listAccountBindingCommands(null, createTask({ id: 't' }))).toEqual([]);
    expect(listAccountBindingCommands(snapshot, createTask({ id: 't', stage: 'merged' }))).toEqual([]);
  });
});

describe('running the step again on an account', () => {
  const snapshot = createSnapshot({
    accounts: [
      createAccount({ id: 'w', email: 'work@example.com' }),
      createAccount({ id: 'h', email: 'home@example.com' }),
    ],
  });

  it('reruns the current step on the account you pick, the account it used checked', () => {
    const rerun = spyOn(accounts, 'rerunStep').mockResolvedValue(true);
    const task = createTask({ id: 't', stage: 'building' });
    const state = createShinsaState({
      tasks: [task],
      runs: [createRun({ id: 'r1', taskId: 't', account: { id: 'w', email: 'work@example.com' } })],
    });
    const [choice] = listRerunCommands(state, snapshot, task);
    expect(choice).toMatchObject({ label: 'Run this step again on…', hint: 'work@example.com', value: 'w' });
    pick(choice, 'h');
    pick(choice, 'missing');
    expect(rerun.mock.calls).toEqual([['t', { id: 'h', email: 'home@example.com' }]]);
    rerun.mockRestore();
  });

  it('is left out when no agent works on the step, or there is no account to pick', () => {
    const checking = createTask({ id: 't', stage: 'checking' });
    const building = createTask({ id: 't', stage: 'building' });
    const runs = [createRun({ id: 'r1', taskId: 't' })];
    expect(listRerunCommands(createShinsaState({ tasks: [checking], runs }), snapshot, checking)).toEqual([]);
    expect(listRerunCommands(createShinsaState({ tasks: [building], runs }), null, building)).toEqual([]);
    const [choice] = listRerunCommands(createShinsaState({ tasks: [building], runs }), snapshot, building);
    expect(choice).toMatchObject({ value: null });
    expect(choice?.hint).toBeUndefined();
  });
});
