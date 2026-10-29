import { describe, expect, spyOn, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AccountImport,
  type AgentModel,
  DomainError,
  type OnboardingFlow,
  type OnboardingStepId,
} from '@shinsa/core';
import { ConfigStore } from '../../src/config/index.ts';
import { log } from '../../src/log/index.ts';
import {
  type AccountActions,
  type ClaudeAccount,
  type CommandRunner,
  Onboarding,
} from '../../src/onboarding/index.ts';
import { Roots } from '../../src/repos/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir, createTestConfig } from '../helpers/index.ts';

const MODELS: AgentModel[] = [
  { id: 'opus', label: 'Opus 5.5', description: '' },
  { id: 'sonnet', label: 'Sonnet 5.5', description: 'Sonnet 5.5 · Efficient for routine tasks' },
];

const ME: ClaudeAccount = { id: 'a-1', email: 'me@example.com', signedIn: true };

const ALL_OK: CommandRunner = (command) =>
  Promise.resolve({
    ok: true,
    code: 0,
    stdout:
      command.join(' ') === 'claude auth status --json'
        ? JSON.stringify({ loggedIn: true })
        : `${command[0]} 1.0`,
    stderr: '',
    timedOut: false,
  });

const NO_BUN: CommandRunner = (command) =>
  command[0] === 'bun'
    ? Promise.resolve({ ok: false, code: 127, stdout: '', stderr: 'bun: not found', timedOut: false })
    : ALL_OK(command, '');

interface Setup {
  accounts?: ClaudeAccount[];
  imports?: AccountImport[];
  importAccount?: AccountActions['importAccount'];
  run?: CommandRunner;
  suggestions?: boolean;
  inspect?: boolean;
  models?: AgentModel[];
}

function setup(options: Setup = {}) {
  const root = createTempDir();
  const config = createTestConfig(root, { roots: [], inspect: options.inspect ?? false });
  const engine = new Engine(new EventLog(config.databasePath));
  const developer = join(root, 'Developer');
  const work = join(root, 'work');
  mkdirSync(join(developer, 'app', '.git'), { recursive: true });
  mkdirSync(work, { recursive: true });
  const accounts = [...(options.accounts ?? [ME])];
  const imports = [...(options.imports ?? [])];
  const importCalls: string[] = [];
  const actions: AccountActions = {
    listImports: () => Promise.resolve([...imports]),
    importAccount: async (origin, email) => {
      importCalls.push(`${origin}:${email}`);
      await options.importAccount?.(origin, email);
      imports.splice(
        imports.findIndex((entry) => entry.email === email),
        1
      );
      accounts.push({ id: `a-${accounts.length + 1}`, email, signedIn: true });
    },
  };
  function open() {
    const store = new ConfigStore(config.configPath);
    const roots = new Roots([], store, root, () =>
      Promise.resolve({
        candidates:
          options.suggestions === false
            ? []
            : [
                { path: developer, repoCount: 3, repos: ['app'] },
                { path: work, repoCount: 1, repos: ['site'] },
              ],
        truncated: false,
      })
    );
    const onboarding = new Onboarding({
      engine,
      config,
      store,
      roots,
      resolveLogin: () => Promise.resolve(null),
      run: options.run ?? ALL_OK,
      models: { listModels: () => Promise.resolve(options.models ?? MODELS) },
      accounts: () => Promise.resolve([...accounts]),
      accountActions: actions,
    });
    return { onboarding, store };
  }
  const first = open();
  return { root, config, engine, developer, work, accounts, imports, importCalls, open, ...first };
}

function answer(onboarding: Onboarding, stepId: OnboardingStepId, ...values: string[]) {
  return onboarding.setup.reply({ type: 'answer', stepId, values });
}

async function answerFolders(onboarding: Onboarding, ...roots: string[]) {
  await answer(onboarding, 'roots', ...roots);
  return onboarding.setup.reply({ type: 'answer', stepId: 'projects', values: ['continue'], projects: [] });
}

function openStep(onboarding: Onboarding, stepId: OnboardingStepId) {
  return onboarding.setup.reply({ type: 'open', stepId });
}

function listChosen(flow: OnboardingFlow) {
  return (flow.step?.options ?? []).filter((option) => option.chosen).map((option) => option.value);
}

function listPicked(flow: OnboardingFlow) {
  return (flow.step?.groups ?? []).flatMap((group) =>
    group.options.filter((option) => option.chosen).map((option) => option.value)
  );
}

async function reachAccounts(world: ReturnType<typeof setup>) {
  await answerFolders(world.onboarding, world.developer);
  return answer(world.onboarding, 'defaults', 'model=opus', 'merge=squash', 'plans=yes');
}

describe('the setup steps', () => {
  test('opens on the folders, the one with the most repositories picked, and the rest of the steps ahead', async () => {
    const { onboarding, developer, work } = setup();
    const flow = await onboarding.setup.resolve();
    expect(flow.index).toBe(0);
    expect(flow.revisit).toBe(false);
    expect(flow.steps.map((step) => [step.id, step.label, step.reached])).toEqual([
      ['roots', 'Folders', true],
      ['projects', 'Projects', false],
      ['defaults', 'Defaults', false],
      ['accounts', 'Accounts', false],
      ['prerequisites', 'Tools', false],
    ]);
    expect(flow.step).toMatchObject({
      id: 'roots',
      title: 'Where do you keep your repositories?',
      multiple: true,
      submitLabel: 'Continue',
      problem: null,
    });
    expect(flow.step?.options.map((option) => [option.value, option.detail, option.chosen])).toEqual([
      [developer, '3 repositories', true],
      [work, '1 repository', false],
    ]);
  });

  test('without suggestions it asks for a path, and a typed folder is saved like a picked one', async () => {
    const { onboarding, store, work } = setup({ suggestions: false });
    const flow = await onboarding.setup.resolve();
    expect(flow.step?.options).toEqual([]);
    expect(flow.step?.description).toContain('found no repositories');
    const next = await answer(onboarding, 'roots', work);
    expect(store.config.roots).toEqual([work]);
    expect(next.step?.id).toBe('projects');
    expect(next.steps[0]?.summary).toMatch(/work$/);
    const back = await openStep(onboarding, 'roots');
    expect(back.step?.options).toEqual([
      { value: work, label: expect.stringMatching(/work$/), detail: null, chosen: true, recommended: false },
    ]);
  });

  test('the defaults come with the recommended choices picked, and Continue saves all three at once', async () => {
    const { onboarding, engine, store, developer, work } = setup();
    const defaults = await answerFolders(onboarding, developer, work);
    expect(store.config.roots).toEqual([developer, work]);
    expect(defaults.step).toMatchObject({ id: 'defaults', title: 'How should agents work?', options: [] });
    expect(defaults.step?.groups.map((group) => [group.id, group.label])).toEqual([
      ['model', 'Model'],
      ['merge', 'Merging'],
      ['plans', 'Large tasks'],
    ]);
    expect(defaults.step?.groups[0]?.options.map((option) => [option.value, option.detail])).toEqual([
      ['model=opus', null],
      ['model=sonnet', 'Efficient for routine tasks'],
      ['model=:roles', 'Planning, building and review each start on the model Shinsa picks for that role.'],
    ]);
    expect(defaults.step?.groups[1]?.options.map((option) => [option.value, option.recommended])).toEqual([
      ['merge=squash', true],
      ['merge=merge', false],
      ['merge=rebase', false],
    ]);
    expect(listPicked(defaults)).toEqual(['model=opus', 'merge=squash', 'plans=yes']);
    const accounts = await answer(onboarding, 'defaults', 'plans=no', 'model=sonnet', 'merge=rebase');
    expect(engine.state.settings).toMatchObject({
      defaultModel: 'sonnet',
      mergeMethod: 'rebase',
      approvePlans: false,
    });
    expect(accounts.step).toMatchObject({ id: 'accounts', submitLabel: 'Continue', imported: [], notes: [] });
    expect(accounts.steps.map((step) => step.summary)).toEqual([
      expect.stringMatching(/Developer and 1 more$/),
      null,
      'Sonnet 5.5 · Rebase · Start building',
      null,
      null,
    ]);
  });

  test('going back to the defaults shows what you saved, and each role’s own model saves no model', async () => {
    const { onboarding, engine, developer } = setup();
    await answerFolders(onboarding, developer);
    await answer(onboarding, 'defaults', 'model=:roles', 'merge=merge', 'plans=no');
    expect(engine.state.settings.defaultModel).toBeNull();
    const back = await openStep(onboarding, 'defaults');
    expect(back.index).toBe(2);
    expect(listPicked(back)).toEqual(['model=:roles', 'merge=merge', 'plans=no']);
    expect(back.steps[3]).toMatchObject({ reached: true, summary: null });
    const next = await answer(onboarding, 'defaults', 'model=opus', 'merge=merge', 'plans=yes');
    expect(next.steps[2]?.summary).toBe('Opus 5.5 · Merge commit · Plan first');
    await openStep(onboarding, 'defaults');
    const roles = await answer(onboarding, 'defaults', 'model=:roles', 'merge=squash', 'plans=yes');
    expect(roles.steps[2]?.summary).toBe('Each role’s own model · Squash · Plan first');
  });

  test('refuses a step you have not reached and an answer for a step that is not open', async () => {
    const { onboarding } = setup();
    await expect(openStep(onboarding, 'defaults')).rejects.toMatchObject({ code: 'step_unreached' });
    await expect(answer(onboarding, 'defaults', 'model=opus')).rejects.toMatchObject({ code: 'step_stale' });
  });

  test('a refused answer stays on its step with the reason, and the next answer clears it', async () => {
    const { onboarding, developer } = setup();
    const refused = await answer(onboarding, 'roots', '/no/such/folder');
    expect(refused.step).toMatchObject({
      id: 'roots',
      problem: '/no/such/folder is not a folder on this machine.',
    });
    await answerFolders(onboarding, developer);
    for (const values of [
      ['model=gpt', 'merge=squash', 'plans=yes'],
      ['merge=squash', 'plans=yes'],
      ['model=opus', 'model=sonnet', 'merge=squash', 'plans=yes'],
      ['opus', 'merge=squash', 'plans=yes'],
    ]) {
      const wrong = await answer(onboarding, 'defaults', ...values);
      expect(wrong.step?.problem).toBe(
        'Pick one model option: Opus 5.5, Sonnet 5.5 or Each role’s own model.'
      );
    }
    const merge = await answer(onboarding, 'defaults', 'model=opus', 'merge=fast', 'plans=yes');
    expect(merge.step?.problem).toBe('Pick one merging option: Squash, Merge commit or Rebase.');
    expect((await openStep(onboarding, 'defaults')).step?.problem).toBeNull();
  });

  test('a folder macOS keeps private stays on the step as access to ask for, not as an error', async () => {
    const world = setup();
    const { onboarding, store, developer, work } = world;
    chmodSync(work, 0o000);
    try {
      const blocked = await answer(onboarding, 'roots', developer, work);
      expect(blocked.step).toMatchObject({ id: 'roots', problem: null, access: [work] });
      expect(listChosen(blocked)).toEqual([developer, work]);
      expect(listChosen(await world.open().onboarding.setup.resolve())).toEqual([developer, work]);
      expect(store.config.roots).toEqual([]);
      chmodSync(work, 0o755);
      const allowed = await answer(onboarding, 'roots', developer, work);
      expect(allowed.step).toMatchObject({ id: 'projects', access: [] });
      expect(store.config.roots).toEqual([developer, work]);
    } finally {
      chmodSync(work, 0o755);
    }
  });

  test('leaving the private folder out moves on with the others', async () => {
    const { onboarding, store, developer, work } = setup();
    chmodSync(work, 0o000);
    try {
      await answer(onboarding, 'roots', developer, work);
      const back = await openStep(onboarding, 'roots');
      expect(back.step?.access).toEqual([]);
      await answer(onboarding, 'roots', work);
      const next = await answer(onboarding, 'roots', developer);
      expect(next.step?.id).toBe('projects');
      expect(store.config.roots).toEqual([developer]);
    } finally {
      chmodSync(work, 0o755);
    }
  });

  test('a saved model outside the catalog is still listed', async () => {
    const { onboarding, engine, developer } = setup();
    await engine.dispatch({ type: 'settings.change', patch: { defaultModel: 'claude-legacy' } });
    const back = await answerFolders(onboarding, developer);
    expect(back.step?.groups[0]?.options[0]).toMatchObject({
      value: 'model=claude-legacy',
      label: 'Legacy',
      chosen: true,
      recommended: true,
    });
    await answer(onboarding, 'defaults', 'model=claude-legacy', 'merge=squash', 'plans=yes');
    expect(engine.state.settings.defaultModel).toBe('claude-legacy');
  });

  test('refuses replies it cannot read', async () => {
    const { onboarding } = setup();
    for (const [body, code] of [
      [{ type: 'answer', stepId: 'nope', values: ['x'] }, 'step_invalid'],
      [{ type: 'answer', stepId: 'roots', values: [] }, 'values_invalid'],
      [{ type: 'answer', stepId: 'roots', values: [3] }, 'values_invalid'],
      [{ type: 'answer', stepId: 'roots', values: 'x' }, 'values_invalid'],
      [{ type: 'shout' }, 'reply_invalid'],
    ] as const) {
      await expect(onboarding.setup.reply(body)).rejects.toMatchObject({ code });
    }
  });
});

describe('the accounts step', () => {
  test('imports every login it finds once, skips one already in your accounts, and says what failed', async () => {
    const world = setup({
      imports: [
        { origin: 'claude', email: 'me@example.com', plan: 'max' },
        { origin: 'cswap', email: 'work@example.com', plan: null },
        { origin: 'cswap', email: 'broken@example.com', plan: null },
      ],
      importAccount: (_origin, email) => {
        if (email === 'broken@example.com') {
          return Promise.reject(new DomainError('import_failed', 'claude-swap did not hand it over.'));
        }
        return Promise.resolve();
      },
    });
    const flow = await reachAccounts(world);
    expect(world.importCalls).toEqual(['cswap:work@example.com', 'cswap:broken@example.com']);
    expect(flow.step).toMatchObject({
      imported: [{ origin: 'cswap', email: 'work@example.com', plan: null }],
      notes: ['claude-swap did not hand it over.'],
    });
    await world.onboarding.setup.resolve();
    expect(world.importCalls).toHaveLength(2);
    expect(flow.steps[3]?.summary).toBeNull();
  });

  test('an account you removed after it was imported is not imported again', async () => {
    const world = setup({ imports: [{ origin: 'cswap', email: 'work@example.com', plan: null }] });
    await reachAccounts(world);
    world.accounts.pop();
    world.imports.push({ origin: 'cswap', email: 'work@example.com', plan: null });
    await openStep(world.onboarding, 'defaults');
    await answer(world.onboarding, 'defaults', 'model=opus', 'merge=squash', 'plans=no');
    expect(world.importCalls).toEqual(['cswap:work@example.com']);
  });

  test('an import that fails in a way Shinsa did not expect is not swallowed', async () => {
    const world = setup({
      imports: [{ origin: 'cswap', email: 'work@example.com', plan: null }],
      importAccount: () => Promise.reject(new Error('disk full')),
    });
    await expect(reachAccounts(world)).rejects.toThrow('disk full');
  });

  test('with no account signed in it offers to skip, and continuing moves on to the tools', async () => {
    const world = setup({ accounts: [{ id: 'a-1', email: null, signedIn: false }] });
    const flow = await reachAccounts(world);
    expect(flow.step?.submitLabel).toBe('Skip for now');
    await expect(answer(world.onboarding, 'accounts', 'later')).resolves.toMatchObject({
      step: { id: 'accounts', problem: 'Continue to the next step.' },
    });
    const tools = await answer(world.onboarding, 'accounts', 'continue');
    expect(tools.step?.id).toBe('prerequisites');
    expect(tools.steps[3]?.summary).toBe('1 account');
  });

  test('counts no accounts as none yet', async () => {
    const world = setup({ accounts: [] });
    await reachAccounts(world);
    const tools = await answer(world.onboarding, 'accounts', 'continue');
    expect(tools.steps[3]?.summary).toBe('None yet');
  });
});

describe('finishing', () => {
  test('checks the tools, finishes setup and stays finished while setup is done', async () => {
    const world = setup({ run: NO_BUN });
    await reachAccounts(world);
    const tools = await answer(world.onboarding, 'accounts', 'continue');
    expect(tools.step).toMatchObject({ id: 'prerequisites', ready: false, submitLabel: 'Finish anyway' });
    expect(tools.step?.checks.find((check) => check.id === 'bun')).toMatchObject({ ok: false });
    const done = await answer(world.onboarding, 'prerequisites', 'continue');
    expect(done).toMatchObject({ index: 5, step: null });
    expect(world.store.config.onboardedAt).not.toBeNull();
    expect((await world.open().onboarding.setup.resolve()).step).toBeNull();
    await expect(openStep(world.onboarding, 'roots')).rejects.toMatchObject({ code: 'setup_finished' });
  });

  test('says when every tool is installed', async () => {
    const world = setup();
    await reachAccounts(world);
    const tools = await answer(world.onboarding, 'accounts', 'continue');
    expect(tools.step).toMatchObject({ ready: true, submitLabel: 'Finish setup' });
  });

  test('a restart after setup shows every step reached and your answers picked', async () => {
    const world = setup();
    await reachAccounts(world);
    await answer(world.onboarding, 'accounts', 'continue');
    await answer(world.onboarding, 'prerequisites', 'continue');
    const again = await world.onboarding.setup.reply({ type: 'restart' });
    expect(again).toMatchObject({ index: 0, revisit: true });
    expect(again.steps.every((step) => step.reached)).toBe(true);
    expect(listPicked(await openStep(world.onboarding, 'defaults'))).toEqual([
      'model=opus',
      'merge=squash',
      'plans=yes',
    ]);
    await openStep(world.onboarding, 'prerequisites');
    expect((await answer(world.onboarding, 'prerequisites', 'continue')).step).toBeNull();
  });
});

describe('the saved setup', () => {
  test('a restart of the server resumes the step you were on', async () => {
    const world = setup();
    await answerFolders(world.onboarding, world.developer);
    const resumed = await world.open().onboarding.setup.resolve();
    expect(resumed.step?.id).toBe('defaults');
  });

  test('a finished setup whose completion was undone starts again', async () => {
    const world = setup();
    await reachAccounts(world);
    await answer(world.onboarding, 'accounts', 'continue');
    await answer(world.onboarding, 'prerequisites', 'continue');
    world.store.update({ onboardedAt: null });
    expect((await world.open().onboarding.setup.resolve()).step?.id).toBe('roots');
  });

  test('a file it cannot read, or one it did not write, starts again', async () => {
    const world = setup();
    const path = join(world.config.dataDir, 'onboarding.json');
    const warn = spyOn(log, 'warn');
    writeFileSync(path, '{');
    expect((await world.open().onboarding.setup.resolve()).index).toBe(0);
    writeFileSync(path, JSON.stringify({ version: 1, messages: [] }));
    expect((await world.open().onboarding.setup.resolve()).index).toBe(0);
    writeFileSync(path, 'null');
    expect((await world.open().onboarding.setup.resolve()).index).toBe(0);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: 4, index: 0 });
  });

  test('in inspect mode it shows the first step, writes nothing and imports nothing', async () => {
    const world = setup({
      inspect: true,
      imports: [{ origin: 'cswap', email: 'w@example.com', plan: null }],
    });
    expect((await world.onboarding.setup.resolve()).step?.id).toBe('roots');
    expect(() => readFileSync(join(world.config.dataDir, 'onboarding.json'))).toThrow();
    world.store.update({ onboardedAt: 1 });
    const inspected = world.open().onboarding;
    expect((await inspected.setup.reply({ type: 'open', stepId: 'accounts' })).step?.imported).toEqual([]);
    expect(world.importCalls).toEqual([]);
  });
});
