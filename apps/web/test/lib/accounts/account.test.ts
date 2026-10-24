import { describe, expect, it } from 'bun:test';
import {
  describeBinding,
  describeDefaultChanged,
  describeImport,
  describeImported,
  describeRemoval,
  describeRerun,
  describeRunsOn,
  listAccountChoices,
  listRerunChoices,
  resolveAccountChoiceValue,
  resolveAccountLabel,
  resolveAccountProvider,
  resolveBoundAccount,
  resolvePauseAction,
  resolveProviderIcon,
  resolveRunAccount,
  SWITCH_REASON,
  selectRerunRun,
} from '@/lib/accounts/account.ts';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { createRun, createTask } from '../../support/state.ts';

describe('account labels', () => {
  it('names an account by its email, or as a Claude account without one', () => {
    expect(resolveAccountLabel({ email: 'me@example.com' })).toBe('me@example.com');
    expect(resolveAccountLabel({ email: null })).toBe('Claude account');
  });

  it('names the provider of every account, with its icon', () => {
    expect(resolveAccountProvider('claude', 'me@example.com')).toEqual({
      icon: 'IconClaudeai',
      label: 'Claude · me@example.com',
    });
    expect(resolveAccountProvider('codex', null)).toEqual({ icon: 'IconOpenaiCodex', label: 'Codex' });
    expect(resolveProviderIcon('cursor')).toBe('IconRobot');
  });

  it('says what an account and a binding run on', () => {
    expect(describeRunsOn({ id: 'a', email: 'a@example.com' })).toBe('Runs on a@example.com');
    expect(describeBinding({ id: 'a', email: null })).toBe('Runs on Claude account.');
    expect(describeBinding(null)).toBe('Runs on any account.');
  });
});

describe('account actions', () => {
  it('confirms a new default account by its name', () => {
    expect(describeDefaultChanged({ email: 'a@example.com' })).toBe('a@example.com is the default account.');
  });

  it('leaves an account out of new work, or takes it back, and says which happened', () => {
    expect(resolvePauseAction(createAccount({ id: 'a', email: 'a@example.com' }))).toEqual({
      label: 'Leave out of new work',
      icon: 'IconPause',
      done: 'New work skips a@example.com.',
    });
    expect(resolvePauseAction(createAccount({ id: 'a', email: 'a@example.com', paused: true }))).toEqual({
      label: 'Use for new work',
      icon: 'IconPlay',
      done: 'a@example.com takes new work again.',
    });
  });
});

describe('binding a task to an account', () => {
  const snapshot = createSnapshot({
    accounts: [
      createAccount({ id: 'a' }),
      createAccount({ id: 'b', signIn: 'signed_out' }),
      createAccount({ id: 'c', email: null }),
    ],
  });

  it('offers any account and every signed-in account', () => {
    const choices = listAccountChoices(snapshot, createTask({ id: 't' }));
    expect(choices.map((choice) => choice.label)).toEqual(['Any account', 'a@example.com', 'Claude account']);
    expect(resolveAccountChoiceValue(createTask({ id: 't' }))).toBe('any');
    expect(resolveBoundAccount(choices, 'a')).toEqual({ id: 'a', email: 'a@example.com' });
    expect(resolveBoundAccount(choices, 'any')).toBeNull();
    expect(resolveBoundAccount(choices, 'gone')).toBeNull();
  });

  it('keeps the bound account in the list even when it is signed out or gone', () => {
    const signedOut = createTask({ id: 't', account: { id: 'b', email: 'b@example.com' } });
    expect(listAccountChoices(snapshot, signedOut).map((choice) => choice.value)).toEqual([
      'any',
      'a',
      'b',
      'c',
    ]);
    expect(resolveAccountChoiceValue(signedOut)).toBe('b');
    const gone = createTask({ id: 't', account: { id: 'z', email: 'z@example.com' } });
    expect(listAccountChoices(null, gone)).toEqual([
      { value: 'any', label: 'Any account', account: null },
      { value: 'z', label: 'z@example.com', account: { id: 'z', email: 'z@example.com' } },
    ]);
  });
});

describe('imports and switches', () => {
  it('names each login it can import', () => {
    expect(describeImport({ origin: 'claude', email: 'me@example.com', plan: 'max' })).toEqual({
      label: 'Use your Claude Code login',
      detail: 'me@example.com',
    });
    expect(describeImport({ origin: 'cswap', email: 'two@example.com', plan: null })).toEqual({
      label: 'Import two@example.com from claude-swap',
      detail: null,
    });
  });

  it('confirms an import, and warns that a claude-swap login must not be refreshed by both', () => {
    expect(describeImported({ origin: 'claude', email: 'me@example.com', plan: 'max' })).toEqual({
      title: 'Added your Claude Code login.',
      description: null,
    });
    expect(describeImported({ origin: 'cswap', email: 'two@example.com', plan: null })).toEqual({
      title: 'Imported two@example.com.',
      description:
        'Remove it from claude-swap or turn off claude-swap’s auto-switch, so only Shinsa refreshes this login.',
    });
  });

  it('removing your Claude Code login only stops using it; removing another account signs it out', () => {
    expect(describeRemoval(createAccount({ id: 'mine', origin: 'claude' }))).toEqual({
      menu: 'Remove from Shinsa',
      title: 'Stop using your Claude Code login?',
      body: 'Shinsa stops running work on it. You stay signed in to Claude Code, and tasks that run only on it go back to any account.',
      action: 'Remove from Shinsa',
    });
    expect(
      describeRemoval(createAccount({ id: 'work', origin: 'login', email: 'work@example.com' }))
    ).toEqual({
      menu: 'Remove',
      title: 'Remove work@example.com?',
      body: 'Shinsa signs this account out and deletes its folder. Tasks that run only on it go back to any account.',
      action: 'Remove account',
    });
  });

  it('says why the account switched', () => {
    expect(SWITCH_REASON.usage_limit).toBe('The previous account hit its usage limit.');
  });
});

describe('running a step again on an account', () => {
  const work = { id: 'w', email: 'work@example.com' };
  const home = { id: 'h', email: 'home@example.com' };

  it('names the account a run used, its latest attempt first, then the one it is bound to', () => {
    const attempt = {
      attemptId: 'a',
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
      startedAt: 1,
    };
    expect(resolveRunAccount(createRun({ id: 'r', taskId: 't' }))).toBeNull();
    expect(resolveRunAccount(createRun({ id: 'r', taskId: 't', account: home }))).toEqual(home);
    expect(
      resolveRunAccount(
        createRun({
          id: 'r',
          taskId: 't',
          account: home,
          attempts: [{ ...attempt }, { ...attempt, account: work }],
        })
      )
    ).toEqual(work);
  });

  it('offers the latest run of a task whose step an agent works on, and nothing on other steps', () => {
    const runs = [createRun({ id: 'r1', taskId: 't' }), createRun({ id: 'r2', taskId: 't' })];
    expect(selectRerunRun(createTask({ id: 't', stage: 'building' }), runs)?.id).toBe('r2');
    expect(selectRerunRun(createTask({ id: 't', stage: 'building' }), [])).toBeNull();
    expect(selectRerunRun(createTask({ id: 't', stage: 'checking' }), runs)).toBeNull();
    expect(selectRerunRun(createTask({ id: 't', stage: 'merged' }), runs)).toBeNull();
  });

  it('offers every account that is signed in, and says where the step runs again', () => {
    const snapshot = createSnapshot({
      accounts: [
        createAccount({ id: 'w', email: 'work@example.com' }),
        createAccount({ id: 'x', email: 'out@example.com', signIn: 'signed_out' }),
      ],
    });
    expect(listRerunChoices(snapshot)).toEqual([{ value: 'w', label: 'work@example.com', account: work }]);
    expect(listRerunChoices(null)).toEqual([]);
    expect(describeRerun(work)).toBe('Running this step again on work@example.com.');
  });
});
