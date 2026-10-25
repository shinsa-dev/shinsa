import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentModel,
  DomainError,
  type OnboardingChat,
  type OnboardingQuestionId,
  type ShinsaCommand,
} from '@shinsa/core';
import type { JsonSchema } from '../../src/agents/providers/index.ts';
import { ConfigStore } from '../../src/config/index.ts';
import { OnboardingConversation, readInterpretation } from '../../src/onboarding/chat.ts';
import {
  type AccountActions,
  type ClaudeAccount,
  type CommandRunner,
  type Interpreter,
  Onboarding,
} from '../../src/onboarding/index.ts';
import type { Asked, Question } from '../../src/onboarding/questions.ts';
import { Roots } from '../../src/repos/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir, createTestConfig } from '../helpers/index.ts';

const MODELS: AgentModel[] = [
  { id: 'opus', label: 'Opus 5.5', description: '' },
  { id: 'sonnet', label: 'Sonnet 5.5', description: 'Sonnet 5.5 · Efficient for routine tasks' },
];

const SIGNED_IN: ClaudeAccount[] = [{ id: 'login', signedIn: true, detail: 'Signed in as me@example.com.' }];

const SIGNED_OUT: ClaudeAccount[] = [{ id: 'login', signedIn: false, detail: 'Not signed in.' }];

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
  interpret?: Interpreter;
  clarify?: Interpreter;
  accounts?: ClaudeAccount[][];
  accountActions?: AccountActions;
  run?: CommandRunner;
  suggestions?: boolean;
  inspect?: boolean;
}

const NO_IMPORTS: AccountActions = {
  listImports: () => Promise.resolve([]),
  importAccount: () => Promise.resolve(),
  startLogin: () => Promise.resolve(),
  isSigningIn: () => false,
};

function setup(options: Setup = {}) {
  const root = createTempDir();
  const config = createTestConfig(root, { roots: [], inspect: options.inspect ?? false });
  const engine = new Engine(new EventLog(config.databasePath));
  const developer = join(root, 'Developer');
  const work = join(root, 'work');
  mkdirSync(join(developer, 'app', '.git'), { recursive: true });
  mkdirSync(work, { recursive: true });
  const prompts: { system: string; prompt: string; schema: JsonSchema }[] = [];
  const accounts = [...(options.accounts ?? [SIGNED_IN])];
  function open() {
    const store = new ConfigStore(config.configPath);
    const roots = new Roots([], store, root, () =>
      Promise.resolve({
        candidates: options.suggestions === false ? [] : [{ path: developer, repoCount: 1, repos: ['app'] }],
        truncated: false,
      })
    );
    const onboarding = new Onboarding({
      engine,
      config,
      store,
      roots,
      run: options.run ?? ALL_OK,
      models: { listModels: () => Promise.resolve(MODELS) },
      accounts: () => Promise.resolve(accounts.length > 1 ? (accounts.shift() ?? []) : (accounts[0] ?? [])),
      accountActions: options.accountActions ?? NO_IMPORTS,
      interpret: async (system, prompt, schema) => {
        prompts.push({ system, prompt, schema });
        return (await options.interpret?.(system, prompt, schema)) ?? null;
      },
      clarify: options.clarify ?? (() => Promise.resolve(null)),
    });
    return { onboarding, store };
  }
  const first = open();
  return { root, config, engine, developer, work, prompts, open, ...first };
}

function lastText(chat: OnboardingChat) {
  return chat.messages.at(-1)?.text;
}

function choose(onboarding: Onboarding, questionId: OnboardingQuestionId, ...values: string[]) {
  return onboarding.chat.reply({ type: 'choose', questionId, values });
}

function say(onboarding: Onboarding, questionId: OnboardingQuestionId, text: string) {
  return onboarding.chat.reply({ type: 'say', questionId, text });
}

describe('the setup chat', () => {
  test('asks the fixed questions in order and saves each answer picked from the options', async () => {
    const { onboarding, store, engine, developer } = setup();
    const opened = await onboarding.chat.resolve();
    expect(opened.messages.map((message) => message.from)).toEqual(['shinsa', 'shinsa']);
    expect(opened.messages[0]?.text).toStartWith('Let’s set up Shinsa. There are 6 questions');
    expect(opened.prompt).toEqual({
      questionId: 'roots',
      step: 1,
      steps: 6,
      mode: 'answer',
      multiple: true,
      choices: [{ value: developer, label: '~/Developer', detail: '1 repository', chosen: false }],
      submitLabel: 'Use these folders',
      placeholder: 'Pick folders or type their paths',
    });

    const model = await choose(onboarding, 'roots', developer);
    expect(store.config.roots).toEqual([developer]);
    expect(model.messages.at(-2)).toMatchObject({ from: 'you', text: '~/Developer' });
    expect(lastText(model)).toBe(
      'Which model should agents use by default? You can still pick a model per role in Settings.'
    );
    expect(model.prompt?.choices.map((choice) => [choice.value, choice.chosen])).toEqual([
      ['opus', false],
      ['sonnet', false],
    ]);

    await choose(onboarding, 'model', 'sonnet');
    const plans = await choose(onboarding, 'merge', 'rebase');
    expect(plans.prompt?.questionId).toBe('plans');
    const accounts = await choose(onboarding, 'plans', 'yes');
    expect(accounts.messages.at(-1)).toMatchObject({
      text: 'Agents work under your Claude accounts. When one runs out of usage, Shinsa moves the work to another. These are the accounts it can use:',
      checks: [{ id: 'login', label: 'Claude', ok: true, detail: 'Signed in as me@example.com.', fix: null }],
    });
    expect(accounts.prompt?.choices.map((choice) => choice.value)).toEqual(['continue', 'add', 'recheck']);
    expect(engine.state.settings).toMatchObject({
      defaultModel: 'sonnet',
      mergeMethod: 'rebase',
      approvePlans: true,
    });

    const tools = await choose(onboarding, 'accounts', 'continue');
    expect(tools.prompt?.choices.map((choice) => choice.label)).toEqual(['Finish setup']);
    expect(tools.messages.at(-1)?.checks.map((check) => check.id)).toEqual([
      'git',
      'gh',
      'gh_auth',
      'claude',
      'claude_auth',
      'codex',
      'codex_auth',
      'bun',
    ]);
    expect(store.config.onboardedAt).toBeNull();

    const done = await choose(onboarding, 'prerequisites', 'continue');
    expect(done.prompt).toBeNull();
    expect(lastText(done)).toBe('Setup is done. Start a task from Home whenever you are ready.');
    expect(store.config.onboardedAt).toBeNumber();
    await expect(choose(onboarding, 'prerequisites', 'continue')).rejects.toThrow(
      'Setup is finished. Start it again from Settings.'
    );
  });

  test('reads a free answer with the model, echoes what it understood and saves it once confirmed', async () => {
    const { onboarding, prompts, developer, store } = setup({
      interpret: () => Promise.resolve({ understood: true, values: ['~/Developer'] }),
    });
    await onboarding.chat.resolve();
    const echoed = await say(onboarding, 'roots', 'the dev folder please');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.prompt).toContain('The question was: Which repository folders should Shinsa use?');
    expect(new Set(prompts.map((call) => call.system)).size).toBe(1);
    expect(prompts[0]?.prompt).toContain(`- ${developer}: 1 repository`);
    expect(prompts[0]?.prompt).toEndWith('The answer:\n"""\nthe dev folder please\n"""');
    expect(lastText(echoed)).toBe('You keep your repositories in ~/Developer (1 repository). Is that right?');
    expect(echoed.prompt).toMatchObject({
      questionId: 'roots',
      mode: 'confirm',
      multiple: false,
      choices: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No, ask again' },
      ],
    });
    expect(store.config.roots).toEqual([]);

    const next = await say(onboarding, 'roots', 'That’s right!');
    expect(store.config.roots).toEqual([developer]);
    expect(next.prompt?.questionId).toBe('model');
  });

  test('a question with one answer asks the model for a typed choice among its options or unclear', async () => {
    const { onboarding, prompts, developer, engine } = setup({
      interpret: (_system, _prompt, schema) =>
        Promise.resolve(
          'choice' in schema.properties ? { choice: 'merge' } : { understood: true, values: ['~/Developer'] }
        ),
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', 'my dev folder');
    await say(onboarding, 'roots', 'yes');
    await choose(onboarding, 'model', 'opus');
    await say(onboarding, 'merge', 'keep the merge bubbles');
    await say(onboarding, 'merge', 'yes');
    expect(engine.state.settings.mergeMethod).toBe('merge');
    const [folders, merge] = prompts;
    expect(folders?.schema).toEqual({
      type: 'object',
      properties: { understood: { type: 'boolean' }, values: { type: 'array', items: { type: 'string' } } },
      required: ['understood', 'values'],
      additionalProperties: false,
    });
    expect(folders?.prompt).toContain(`- ${developer}: 1 repository`);
    expect(folders?.prompt).toContain('If the answer does not clearly choose, return {"understood": false');
    expect(merge?.schema).toEqual({
      type: 'object',
      properties: { choice: { type: 'string', enum: ['squash', 'merge', 'rebase', 'keep', 'unclear'] } },
      required: ['choice'],
      additionalProperties: false,
    });
    expect(merge?.prompt).toContain(
      '- choice (choice): Which option does the answer choose? It may name the option, describe it in its own words (cheaper, faster, only when I ask) or agree to it. Options: "squash": Squash: every pull request lands as one commit; "merge": Merge commit: every commit is kept and a merge commit joins them; "rebase": Rebase: the commits are replayed onto the default branch, a straight history without a merge commit; "keep": the answer skips the question, has no preference, leaves it to Shinsa or asks to keep the current setting or the default; "unclear": the answer fits none of the options, or could mean more than one of them. Answer with exactly one option, copied exactly.'
    );
  });

  test('tells the model what each option means, so an answer that describes one is read', async () => {
    const { onboarding, prompts, engine } = setup({
      interpret: (_system, prompt) =>
        Promise.resolve({ choice: prompt.includes('Should agents ask you') ? 'no' : 'sonnet' }),
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await say(onboarding, 'model', 'the cheaper one');
    await say(onboarding, 'model', 'yes');
    await choose(onboarding, 'merge', 'squash');
    await say(onboarding, 'plans', 'only when I ask');
    const plans = await say(onboarding, 'plans', 'yes');
    expect(plans.prompt?.questionId).toBe('accounts');
    expect(engine.state.settings).toMatchObject({ defaultModel: 'sonnet', approvePlans: false });
    const [model, plan] = prompts;
    expect(model?.prompt).toContain('"opus": Opus 5.5; "sonnet": Sonnet 5.5: Efficient for routine tasks;');
    expect(plan?.prompt).toContain(
      '"no": No, start building: agents start building straight away and plan first only when the human asks for a plan;'
    );
  });

  test('a bare yes keeps what is saved where no option is a yes, without the model', async () => {
    const { onboarding, prompts, engine } = setup();
    await engine.dispatch({
      type: 'settings.change',
      patch: { defaultModel: 'opus', mergeMethod: 'rebase' },
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    const model = await say(onboarding, 'model', 'sure thing');
    expect(model.messages.at(-2)?.text).toBe('Agents use Opus 5.5 by default.');
    const merge = await say(onboarding, 'merge', 'yes please');
    expect(merge.messages.at(-2)?.text).toBe(
      'Pull requests are rebased onto the default branch when you merge them.'
    );
    expect(merge.prompt?.questionId).toBe('plans');
    expect(engine.state.settings).toMatchObject({ defaultModel: 'opus', mergeMethod: 'rebase' });
    expect(prompts).toHaveLength(0);
  });

  test('a saved answer changes the settings under an id from the chat, the question and the answer', async () => {
    const { onboarding, open, engine, config } = setup();
    const dispatch = spyOn(engine, 'dispatch');
    const path = join(config.dataDir, 'onboarding.json');
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await choose(onboarding, 'model', 'opus');
    const before = readFileSync(path, 'utf8');
    await choose(onboarding, 'merge', 'rebase');
    await engine.dispatch({ type: 'settings.change', patch: { mergeMethod: 'squash' } });
    writeFileSync(path, before);
    await choose(open().onboarding, 'merge', 'rebase');
    expect(engine.state.settings.mergeMethod).toBe('squash');
    writeFileSync(path, before);
    await choose(open().onboarding, 'merge', 'merge');
    expect(engine.state.settings.mergeMethod).toBe('merge');
    const restarted = open().onboarding;
    await restarted.chat.reply({ type: 'restart' });
    await say(restarted, 'roots', '~/Developer');
    await choose(restarted, 'model', 'opus');
    await choose(restarted, 'merge', 'rebase');
    expect(engine.state.settings.mergeMethod).toBe('rebase');

    const ids = dispatch.mock.calls
      .filter(([command]: [ShinsaCommand, ...unknown[]]) => command.type === 'settings.change')
      .map(([, options]) => (options as { id?: string } | undefined)?.id ?? null);
    const [model, rebase, , repeat, merge, , again] = ids;
    expect(ids[2]).toBeNull();
    expect(model).toMatch(/^setup:[\w-]+:model:\w+$/);
    expect(rebase).toMatch(/^setup:[\w-]+:merge:\w+$/);
    expect(repeat).toBe(rebase);
    expect(merge).not.toBe(rebase);
    expect(merge?.split(':').slice(0, 3)).toEqual(rebase?.split(':').slice(0, 3));
    expect(again).not.toBe(rebase);
    expect(again?.split(':')[1]).not.toBe(rebase?.split(':')[1]);
  });

  test('asks the question again when you say the echo is wrong', async () => {
    const { onboarding, store } = setup({
      interpret: () => Promise.resolve({ choice: 'sonnet' }),
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await say(onboarding, 'model', 'the mid one');
    const again = await choose(onboarding, 'model', 'no');
    expect(again.messages.at(-2)).toMatchObject({ from: 'you', text: 'No, ask again' });
    expect(lastText(again)).toStartWith('Which model should agents use by default?');
    expect(again.prompt?.mode).toBe('answer');

    await say(onboarding, 'model', 'the mid one');
    const typedNo = await say(onboarding, 'model', 'nope');
    expect(typedNo.prompt?.mode).toBe('answer');

    await say(onboarding, 'model', 'the mid one');
    await expect(choose(onboarding, 'model', 'opus')).rejects.toThrow('Answer yes or no.');
    const accepted = await choose(onboarding, 'model', 'yes');
    expect(accepted.prompt?.questionId).toBe('merge');
    expect(store.config.roots).toHaveLength(1);
  });

  test('a new answer during a confirmation replaces the one being confirmed', async () => {
    const { onboarding, engine } = setup({
      interpret: (_system, prompt) =>
        Promise.resolve({ choice: prompt.split('The answer:')[1]?.includes('cheap') ? 'sonnet' : 'opus' }),
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await say(onboarding, 'model', 'the best one');
    const replaced = await say(onboarding, 'model', 'no, the cheap one');
    expect(lastText(replaced)).toBe('Agents use Sonnet 5.5 by default. Is that right?');
    await say(onboarding, 'model', 'ok');
    expect(engine.state.settings.defaultModel).toBe('sonnet');
  });

  test('when the model cannot be reached it says so and keeps the options on screen', async () => {
    const { onboarding } = setup({
      interpret: () => Promise.reject(new Error('The model is down.')),
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    const fallback = await say(onboarding, 'model', 'whatever is fastest');
    expect(fallback.messages.at(-1)).toMatchObject({
      from: 'shinsa',
      problem: true,
      text: 'I could not read that answer just now. Pick one of the options or answer again.',
    });
    expect(fallback.prompt).toMatchObject({ questionId: 'model', mode: 'answer' });
    expect(fallback.prompt?.choices.map((choice) => choice.label)).toEqual(['Opus 5.5', 'Sonnet 5.5']);
  });

  test('an unclear answer gets a follow-up the writer model wrote that names the options, or the fixed text without one', async () => {
    const asked: { system: string; prompt: string; schema: JsonSchema }[] = [];
    const followUps: (() => Promise<unknown>)[] = [
      () =>
        Promise.resolve({
          follow_up: 'Opus 5.5 is the strongest \u2014 Sonnet 5.5 is cheaper and quick.   Which one?',
        }),
      () => Promise.reject(new Error('The writer is down.')),
      () => Promise.resolve({ follow_up: '  ' }),
      () => Promise.resolve({ follow_up: 'x'.repeat(241) }),
      () => Promise.resolve({ follow_up: 42 }),
      () => Promise.resolve(null),
    ];
    const { onboarding } = setup({
      interpret: () => Promise.resolve({ choice: 'unclear' }),
      clarify: (system, prompt, schema) => {
        asked.push({ system, prompt, schema });
        return followUps.shift()?.() ?? Promise.resolve(null);
      },
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    const helped = await say(onboarding, 'model', 'whichever, I guess');
    expect(helped.messages.at(-1)).toMatchObject({
      from: 'shinsa',
      problem: false,
      text: 'Opus 5.5 is the strongest, Sonnet 5.5 is cheaper and quick. Which one?',
    });
    expect(helped.prompt).toMatchObject({ questionId: 'model', mode: 'answer' });
    expect(asked[0]?.system).toContain('names each option in everyday words');
    expect(asked[0]?.prompt).toStartWith('The question: Which model should agents use by default?');
    expect(asked[0]?.prompt).toContain(
      'The options:\n- Opus 5.5\n- Sonnet 5.5: Efficient for routine tasks\n'
    );
    expect(asked[0]?.prompt).toEndWith('Their answer:\n"""\nwhichever, I guess\n"""');
    expect(asked[0]?.schema).toMatchObject({ required: ['follow_up'] });
    for (const text of ['hmm', 'the new one', 'the big one', 'the old one', 'the purple one']) {
      const fallback = await say(onboarding, 'model', text);
      expect(fallback.messages.at(-1)).toMatchObject({
        problem: true,
        text: 'I could not tell what you meant. Pick one of the options or answer again.',
      });
    }
    expect(asked).toHaveLength(6);
  });

  test('a folder answer the model cannot place gets a follow-up that says paths work too', async () => {
    const prompts: string[] = [];
    const { onboarding } = setup({
      interpret: () => Promise.resolve({ understood: false, values: [] }),
      clarify: (_system, prompt) => {
        prompts.push(prompt);
        return Promise.resolve({
          follow_up: 'Is your code in ~/Developer, or somewhere else? Type the path.',
        });
      },
    });
    await onboarding.chat.resolve();
    const helped = await say(onboarding, 'roots', 'where I keep stuff');
    expect(lastText(helped)).toBe('Is your code in ~/Developer, or somewhere else? Type the path.');
    expect(prompts[0]).toContain('They may also type full paths.');
  });

  test('re-asks when the model is unsure or picks something that is not an option', async () => {
    const answers: unknown[] = [
      { choice: 'unclear' },
      { choice: 'gpt-9' },
      { understood: true, values: ['opus'] },
      null,
    ];
    const { onboarding } = setup({ interpret: () => Promise.resolve(answers.shift()) });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    for (const text of ['hmm', 'the new one', 'the big one']) {
      const unclear = await say(onboarding, 'model', text);
      expect(lastText(unclear)).toBe(
        'I could not tell what you meant. Pick one of the options or answer again.'
      );
    }
    await expect(choose(onboarding, 'model', 'gpt-9')).resolves.toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          text: 'Pick one of these: Opus 5.5 or Sonnet 5.5. Pick one of the options or answer again.',
        }),
      ]),
    });
    const silent = await say(onboarding, 'model', 'again');
    expect(silent.messages.at(-1)?.problem).toBe(true);
    expect(silent.prompt?.questionId).toBe('model');
  });

  test('takes an answer that names an option or lists paths without asking the model', async () => {
    const { onboarding, prompts, store, developer, work, engine } = setup();
    await onboarding.chat.resolve();
    const wrong = await say(onboarding, 'roots', '~/Developer, /no/such/folder');
    expect(lastText(wrong)).toBe(
      '/no/such/folder is not a folder on this machine. Pick folders or type their full paths.'
    );
    await say(onboarding, 'roots', '~/Developer and ~/work');
    expect(store.config.roots).toEqual([developer, work]);
    await say(onboarding, 'model', 'Opus 5.5');
    await say(onboarding, 'merge', 'merge commit.');
    expect(engine.state.settings.mergeMethod).toBe('merge');
    expect(prompts).toHaveLength(0);
  });

  test('picks up where you left off after a reload, mid-confirmation included', async () => {
    const { onboarding, open } = setup({
      interpret: () => Promise.resolve({ choice: 'rebase' }),
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await choose(onboarding, 'model', 'opus');
    const before = await say(onboarding, 'merge', 'keep history linear');
    const reloaded = await open().onboarding.chat.resolve();
    expect(reloaded).toEqual(before);
    expect(reloaded.prompt).toMatchObject({ questionId: 'merge', mode: 'confirm', step: 3 });
    const after = await open().onboarding.chat.reply({ type: 'say', questionId: 'merge', text: 'yes' });
    expect(after.prompt?.questionId).toBe('plans');
  });

  test('checks the Claude login again until you are signed in, or lets you skip it', async () => {
    const { onboarding } = setup({ accounts: [SIGNED_OUT, SIGNED_OUT, SIGNED_IN] });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await choose(onboarding, 'model', 'opus');
    await choose(onboarding, 'merge', 'squash');
    const signedOut = await choose(onboarding, 'plans', 'no');
    expect(signedOut.messages.at(-1)).toMatchObject({
      text: 'Agents need a Claude account. Use the login Claude Code already has, or sign in with an account.',
      checks: [{ ok: false, fix: 'Choose “Sign in again as Claude” below.' }],
    });
    expect(signedOut.prompt?.choices.map((choice) => choice.value)).toEqual([
      'sign_in:login',
      'add',
      'recheck',
      'continue',
    ]);
    const still = await choose(onboarding, 'accounts', 'recheck');
    expect(still.messages.at(-2)).toMatchObject({ from: 'you', text: 'Check again' });
    expect(still.prompt?.questionId).toBe('accounts');
    const signedIn = await say(onboarding, 'accounts', 'check again');
    expect(signedIn.messages.at(-1)?.checks[0]?.ok).toBe(true);
    const skipped = await say(onboarding, 'accounts', 'use these accounts');
    expect(skipped.prompt?.questionId).toBe('prerequisites');
  });

  test('in inspect mode it shows the first question and writes nothing to the data directory', async () => {
    const { onboarding, config } = setup({ inspect: true });
    const chat = await onboarding.chat.resolve();
    expect(chat.prompt?.questionId).toBe('roots');
    expect(existsSync(join(config.dataDir, 'onboarding.json'))).toBe(false);
  });

  test('says how to fix a missing tool and lets you finish anyway', async () => {
    const { onboarding, store } = setup({
      run: NO_BUN,
      interpret: () => Promise.resolve({ choice: 'recheck' }),
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await choose(onboarding, 'model', 'opus');
    await choose(onboarding, 'merge', 'squash');
    await choose(onboarding, 'plans', 'no');
    const missing = await choose(onboarding, 'accounts', 'continue');
    expect(lastText(missing)).toStartWith('Last, the tools Shinsa runs on this machine. Some are missing');
    expect(missing.messages.at(-1)?.checks.find((check) => check.id === 'bun')).toMatchObject({
      ok: false,
      fix: 'Install Bun from https://bun.sh.',
    });
    const rechecked = await say(onboarding, 'prerequisites', 'I installed it, look again');
    expect(rechecked.messages.at(-2)).toMatchObject({ from: 'you', text: 'I installed it, look again' });
    expect(lastText(rechecked)).toStartWith('Last, the tools Shinsa runs on this machine.');
    const done = await choose(onboarding, 'prerequisites', 'continue');
    expect(done.prompt).toBeNull();
    expect(store.config.onboardedAt).toBeNumber();
  });

  test('without suggestions it asks for paths, and it marks the folders you already chose', async () => {
    const { onboarding, developer } = setup({ suggestions: false });
    const opened = await onboarding.chat.resolve();
    expect(lastText(opened)).toEndWith('so type the full path of each folder.');
    expect(opened.prompt?.choices).toEqual([]);
    await say(onboarding, 'roots', '~/Developer');
    const restarted = await onboarding.chat.reply({ type: 'restart' });
    expect(restarted.messages).toHaveLength(2);
    expect(restarted.prompt?.choices).toEqual([
      { value: developer, label: '~/Developer', detail: null, chosen: true },
    ]);
  });

  test('lists a default model that is not in the catalog, so it can be kept', async () => {
    const { onboarding, engine } = setup();
    await engine.dispatch({ type: 'settings.change', patch: { defaultModel: 'claude-opus-4-1' } });
    await onboarding.chat.resolve();
    const model = await say(onboarding, 'roots', '~/Developer');
    expect(model.prompt?.choices[0]).toEqual({
      value: 'claude-opus-4-1',
      label: 'Opus 4.1',
      detail: null,
      chosen: false,
    });
    const kept = await say(onboarding, 'model', 'keep the current one');
    expect(kept.messages.at(-2)?.text).toBe('Agents use Opus 4.1 by default.');
    expect(engine.state.settings.defaultModel).toBe('claude-opus-4-1');
  });

  test('refuses replies it cannot use and answers to a question that already moved on', async () => {
    const { onboarding, developer } = setup();
    await onboarding.chat.resolve();
    for (const [body, message] of [
      [{ type: 'choose', questionId: 'colour', values: ['x'] }, 'Answer a setup question.'],
      [{ type: 'choose', questionId: 'roots', values: [] }, 'Pick at least one option.'],
      [{ type: 'choose', questionId: 'roots', values: [3] }, 'Pick at least one option.'],
      [{ type: 'say', questionId: 'roots', text: '  ' }, 'Write an answer first.'],
      [
        { type: 'say', questionId: 'roots', text: 'x'.repeat(2001) },
        'Keep the answer under 2,000 characters.',
      ],
      [{ type: 'shout', questionId: 'roots' }, 'Pick an option or write an answer.'],
      [{ type: 'choose', questionId: 'model', values: ['opus'] }, 'That question was already answered.'],
    ] as const) {
      await expect(onboarding.chat.reply(body)).rejects.toThrow(message);
    }
    const [first, second] = await Promise.allSettled([
      choose(onboarding, 'roots', developer),
      choose(onboarding, 'roots', developer),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({ status: 'rejected', reason: { code: 'question_stale' } });
  });

  test('starts again when the saved chat is unreadable, not its own, or finished without setup done', async () => {
    const { config, open, onboarding, store, developer } = setup();
    const path = join(config.dataDir, 'onboarding.json');
    writeFileSync(path, '{ torn');
    expect((await open().onboarding.chat.resolve()).messages).toHaveLength(2);
    writeFileSync(path, JSON.stringify({ version: 2 }));
    expect((await open().onboarding.chat.resolve()).messages).toHaveLength(2);
    writeFileSync(path, 'null');
    expect((await open().onboarding.chat.resolve()).messages).toHaveLength(2);

    await onboarding.chat.reply({ type: 'restart' });
    await choose(onboarding, 'roots', developer);
    await choose(onboarding, 'model', 'opus');
    await choose(onboarding, 'merge', 'squash');
    await choose(onboarding, 'plans', 'no');
    await choose(onboarding, 'accounts', 'continue');
    await choose(onboarding, 'prerequisites', 'continue');
    expect((await open().onboarding.chat.resolve()).prompt).toBeNull();
    store.update({ onboardedAt: null });
    expect((await open().onboarding.chat.resolve()).prompt?.questionId).toBe('roots');
  });

  test('a folder that disappears before you confirm it is reported, not saved', async () => {
    const { onboarding, work, store } = setup({
      interpret: () => Promise.resolve({ understood: true, values: ['~/work'] }),
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', 'my work folder');
    rmSync(work, { recursive: true });
    const refused = await say(onboarding, 'roots', 'yes');
    expect(lastText(refused)).toBe(
      `${work} is not a folder on this machine. Pick folders or type their full paths.`
    );
    expect(store.config.roots).toEqual([]);
  });

  test('keeps the latest 300 messages', async () => {
    const { onboarding } = setup();
    await onboarding.chat.resolve();
    let chat: OnboardingChat | null = null;
    for (let attempt = 0; attempt < 160; attempt += 1) chat = await say(onboarding, 'roots', '/nope');
    expect(chat?.messages).toHaveLength(300);
    expect(chat?.messages.at(-1)?.id).toBe('m322');
  });
});

describe('answers in your own words', () => {
  test('a confirmation in your own words saves the answer without asking the model again', async () => {
    const { onboarding, prompts, store, engine, developer } = setup({
      interpret: (_system, _prompt, schema) =>
        Promise.resolve(
          'choice' in schema.properties ? { choice: 'rebase' } : { understood: true, values: ['~/Developer'] }
        ),
    });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', 'my dev folder');
    await say(onboarding, 'roots', 'Yes please!');
    expect(store.config.roots).toEqual([developer]);
    await say(onboarding, 'model', 'opus');
    await say(onboarding, 'merge', 'keep history linear');
    const refused = await say(onboarding, 'merge', 'not quite');
    expect(refused.prompt).toMatchObject({ questionId: 'merge', mode: 'answer' });
    await say(onboarding, 'merge', 'keep history linear');
    const saved = await say(onboarding, 'merge', 'Yep, that’s right, thanks');
    expect(saved.prompt?.questionId).toBe('plans');
    expect(engine.state.settings.mergeMethod).toBe('rebase');
    expect(prompts.map((entry) => entry.prompt.split('\n\n').at(-1))).toEqual([
      'The answer:\n"""\nmy dev folder\n"""',
      'The answer:\n"""\nkeep history linear\n"""',
      'The answer:\n"""\nkeep history linear\n"""',
    ]);
  });

  test('an answer the model cannot read during a confirmation keeps the confirmation open', async () => {
    const answers: unknown[] = [{ choice: 'rebase' }, { choice: 'unclear' }, null];
    const { onboarding } = setup({ interpret: () => Promise.resolve(answers.shift()) });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await say(onboarding, 'model', 'opus');
    await say(onboarding, 'merge', 'keep history linear');
    const unclear = await say(onboarding, 'merge', 'hmm, what does that do');
    expect(lastText(unclear)).toBe(
      'I could not tell what you meant. Pick Yes or No, or answer the question again.'
    );
    expect(unclear.prompt).toMatchObject({ questionId: 'merge', mode: 'confirm' });
    const unreadable = await say(onboarding, 'merge', 'what is a merge queue');
    expect(lastText(unreadable)).toBe(
      'I could not read that answer just now. Pick Yes or No, or answer the question again.'
    );
    const saved = await choose(onboarding, 'merge', 'yes');
    expect(saved.prompt?.questionId).toBe('plans');
  });

  test('repeating the answer being confirmed saves it instead of asking again', async () => {
    const { onboarding, engine } = setup({ interpret: () => Promise.resolve({ choice: 'sonnet' }) });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await say(onboarding, 'model', 'the mid one');
    const saved = await say(onboarding, 'model', 'yes, the mid one');
    expect(saved.prompt?.questionId).toBe('merge');
    expect(engine.state.settings.defaultModel).toBe('sonnet');
  });

  test('takes an answer that names one option in a sentence without the model', async () => {
    const { onboarding, prompts, engine, store, developer } = setup();
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', 'the developer folder');
    expect(store.config.roots).toEqual([developer]);
    await say(onboarding, 'model', 'use sonnet please');
    const merged = await say(onboarding, 'merge', 'squash merges');
    expect(merged.messages.slice(-3).map((message) => message.text)).toEqual([
      'squash merges',
      'Pull requests are squashed into one commit when you merge them.',
      'Should agents ask you to approve a plan before they build a large task?',
    ]);
    const plans = await say(onboarding, 'plans', 'no, only when I ask');
    expect(plans.prompt?.questionId).toBe('accounts');
    expect(engine.state.settings).toMatchObject({
      defaultModel: 'sonnet',
      mergeMethod: 'squash',
      approvePlans: false,
    });
    expect(prompts).toHaveLength(0);
  });

  test('sends an answer that names two options or turns one down to the model', async () => {
    const { onboarding, prompts } = setup({ interpret: () => Promise.resolve({ choice: 'unclear' }) });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    for (const text of ['not opus', 'opus or sonnet', 'opus, but not for planning']) {
      await say(onboarding, 'model', text);
    }
    expect(prompts).toHaveLength(3);
  });

  test('agreeing goes on with the option shown first, and yes answers a yes or no question', async () => {
    const { onboarding, prompts, engine, store } = setup();
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await choose(onboarding, 'model', 'opus');
    await choose(onboarding, 'merge', 'squash');
    await say(onboarding, 'plans', 'yes please');
    expect(engine.state.settings.approvePlans).toBe(true);
    const tools = await say(onboarding, 'accounts', 'looks good');
    expect(tools.prompt?.questionId).toBe('prerequisites');
    const done = await say(onboarding, 'prerequisites', 'ok');
    expect(done.prompt).toBeNull();
    expect(store.config.onboardedAt).toBeNumber();
    expect(prompts).toHaveLength(0);
  });

  test('skipping keeps what is saved and says so, and a question with nothing saved needs an answer', async () => {
    const { onboarding, prompts, engine, store, developer } = setup();
    await engine.dispatch({
      type: 'settings.change',
      patch: { defaultModel: null, mergeMethod: 'rebase', approvePlans: true },
    });
    await onboarding.chat.resolve();
    const required = await say(onboarding, 'roots', 'skip');
    expect(lastText(required)).toBe('This question needs an answer. Pick folders or type their full paths.');
    await choose(onboarding, 'roots', developer);
    const model = await say(onboarding, 'model', 'Skip for now.');
    expect(model.messages.at(-2)?.text).toBe(
      'Agents keep the model each role starts with. You can change it in Settings.'
    );
    const merge = await say(onboarding, 'merge', 'use the default');
    expect(merge.messages.at(-2)?.text).toBe(
      'Pull requests are rebased onto the default branch when you merge them.'
    );
    await say(onboarding, 'plans', 'no preference');
    await say(onboarding, 'accounts', 'skip');
    const done = await say(onboarding, 'prerequisites', 'skip');
    expect(done.prompt).toBeNull();
    expect(engine.state.settings).toMatchObject({
      defaultModel: null,
      mergeMethod: 'rebase',
      approvePlans: true,
    });
    expect(store.config.roots).toEqual([developer]);
    const again = await onboarding.chat.reply({ type: 'restart' });
    expect(again.prompt?.choices[0]?.chosen).toBe(true);
    const kept = await say(onboarding, 'roots', 'skip');
    expect(kept.messages.at(-2)?.text).toBe('You keep your repositories in ~/Developer (1 repository).');
    expect(prompts).toHaveLength(0);
  });

  test('the model can say an answer keeps the current setting', async () => {
    const { onboarding, engine } = setup({ interpret: () => Promise.resolve({ choice: 'keep' }) });
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await choose(onboarding, 'model', 'opus');
    const kept = await say(onboarding, 'merge', 'whatever you think is best');
    expect(kept.messages.at(-2)?.text).toBe(
      'Pull requests are squashed into one commit when you merge them.'
    );
    expect(kept.prompt?.questionId).toBe('plans');
    expect(engine.state.settings.mergeMethod).toBe('squash');
  });

  test('no single-choice option is marked chosen, even when a value is saved', async () => {
    const { onboarding, engine } = setup();
    await engine.dispatch({
      type: 'settings.change',
      patch: { defaultModel: 'sonnet', mergeMethod: 'merge', approvePlans: true },
    });
    await onboarding.chat.resolve();
    const model = await say(onboarding, 'roots', '~/Developer');
    const merge = await choose(onboarding, 'model', 'sonnet');
    const plans = await choose(onboarding, 'merge', 'merge');
    for (const chat of [model, merge, plans]) {
      expect(chat.prompt?.choices.some((choice) => choice.chosen)).toBe(false);
    }
  });
});

describe('OnboardingConversation', () => {
  const ASKED: Asked = {
    text: 'Pick one.',
    checks: [],
    choices: [{ value: 'a', label: 'A', detail: null, chosen: false }],
    multiple: false,
    submitLabel: null,
    placeholder: 'Answer',
    retry: 'Try again.',
  };

  function createConversation(question: Partial<Question>, completes: (() => Promise<void>)[] = []) {
    const path = join(createTempDir(), 'chat.json');
    return new OnboardingConversation({
      path,
      questions: [
        {
          id: 'merge',
          confirms: false,
          ask: () => Promise.resolve(ASKED),
          instruct: () => '',
          resolve: (values) => ({ values, echo: 'A.' }),
          save: () => Promise.resolve('next'),
          skip: () => null,
          ...question,
        },
      ],
      resolveContext: () => Promise.resolve({} as never),
      interpret: () => Promise.resolve(null),
      clarify: () => Promise.resolve(null),
      isCompleted: () => false,
      complete: () => completes.shift()?.() ?? Promise.resolve(),
    });
  }

  test('a broken question fails the reply instead of becoming a chat message', async () => {
    const resolving = createConversation({
      resolve: () => {
        throw new TypeError('broken');
      },
    });
    await resolving.resolve();
    await expect(resolving.reply({ type: 'choose', questionId: 'merge', values: ['a'] })).rejects.toThrow(
      'broken'
    );
    const saving = createConversation({ save: () => Promise.reject(new TypeError('disk full')) });
    await saving.resolve();
    await expect(saving.reply({ type: 'choose', questionId: 'merge', values: ['a'] })).rejects.toThrow(
      'disk full'
    );
  });

  test('a setup that cannot complete says why and stays on the last question', async () => {
    const conversation = createConversation({}, [
      () => Promise.reject(new DomainError('roots_required', 'Choose the folders first.')),
    ]);
    await conversation.resolve();
    const refused = await conversation.reply({ type: 'choose', questionId: 'merge', values: ['a'] });
    expect(refused.messages.at(-1)).toMatchObject({
      problem: true,
      text: 'Choose the folders first. Try again.',
    });
    expect(refused.prompt?.questionId).toBe('merge');
  });
});

describe('reading answers', () => {
  const ASKED = {
    text: '',
    checks: [],
    choices: [{ value: 'squash', label: 'Squash', detail: null, chosen: false }],
    multiple: false,
    submitLabel: null,
    placeholder: '',
    retry: '',
  } satisfies Asked;

  test('readInterpretation takes one of the options, or unclear, where one option is asked', () => {
    expect(readInterpretation(null, ASKED)).toBeNull();
    expect(readInterpretation(undefined, ASKED)).toBeNull();
    expect(readInterpretation({ choice: 'squash' }, ASKED)).toEqual(['squash']);
    expect(readInterpretation({ choice: 'keep' }, ASKED)).toBe('skip');
    for (const value of [
      'squash',
      [],
      { choice: 'unclear' },
      { choice: 'merge' },
      { choice: ['squash'] },
      { understood: true, values: ['squash'] },
    ]) {
      expect(readInterpretation(value, ASKED)).toBe('unclear');
    }
  });

  test('readInterpretation takes an understood list of strings where several values are asked', () => {
    const folders = { ...ASKED, multiple: true };
    expect(readInterpretation(null, folders)).toBeNull();
    expect(readInterpretation({ understood: false }, folders)).toBe('unclear');
    expect(readInterpretation({ understood: true, values: [] }, folders)).toBe('unclear');
    expect(readInterpretation({ understood: true, values: [1] }, folders)).toBe('unclear');
    expect(
      readInterpretation({ understood: true, values: Array.from({ length: 51 }, () => 'x') }, folders)
    ).toBe('unclear');
    expect(readInterpretation({ choice: '~/a' }, folders)).toBe('unclear');
    expect(readInterpretation({ understood: true, values: ['~/a'] }, folders)).toEqual(['~/a']);
  });
});

describe('the accounts step with Shinsa’s own accounts', () => {
  function createActions() {
    const done: string[] = [];
    let signingIn = false;
    let imports = [
      { origin: 'claude' as const, email: 'me@example.com', plan: 'max' },
      { origin: 'cswap' as const, email: 'swap@example.com', plan: null },
    ];
    const actions: AccountActions = {
      listImports: () => Promise.resolve(imports),
      importAccount: (origin, email) => {
        done.push(`import ${origin} ${email}`);
        if (email === 'broken@example.com')
          return Promise.reject(new DomainError('import_failed', 'It did not work.'));
        imports = imports.filter((entry) => entry.email !== email);
        return Promise.resolve();
      },
      startLogin: (accountId) => {
        done.push(accountId ? `login ${accountId}` : 'login');
        signingIn = true;
        return Promise.resolve();
      },
      isSigningIn: () => signingIn,
    };
    return { actions, done };
  }

  async function reachAccounts(onboarding: Onboarding) {
    await onboarding.chat.resolve();
    await say(onboarding, 'roots', '~/Developer');
    await choose(onboarding, 'model', 'opus');
    await choose(onboarding, 'merge', 'squash');
    return choose(onboarding, 'plans', 'no');
  }

  test('offers the logins it can import and a new sign-in, does them in place and asks again', async () => {
    const { actions, done } = createActions();
    const signedIn: ClaudeAccount[] = [
      { id: 'a', signedIn: true, detail: 'Signed in, Max plan.', label: 'me@example.com' },
    ];
    const { onboarding } = setup({ accounts: [[], [], signedIn], accountActions: actions });
    const asked = await reachAccounts(onboarding);
    expect(lastText(asked)).toBe(
      'Agents need a Claude account. Use the login Claude Code already has, or sign in with an account.'
    );
    expect(asked.prompt?.choices.map((choice) => [choice.value, choice.label, choice.detail])).toEqual([
      ['import:claude:me@example.com', 'Use your Claude Code login', 'me@example.com'],
      ['import:cswap:swap@example.com', 'Import from claude-swap', 'swap@example.com'],
      ['add', 'Sign in with another account', null],
      ['recheck', 'Check again', null],
      ['continue', 'Skip for now', null],
    ]);
    const signing = await choose(onboarding, 'accounts', 'add');
    expect(lastText(signing)).toStartWith(
      'Claude opened a browser window to sign in. Finish there, then choose Check again.'
    );
    const imported = await choose(onboarding, 'accounts', 'import:claude:me@example.com');
    expect(imported.messages.at(-1)).toMatchObject({
      checks: [{ id: 'a', label: 'me@example.com', ok: true, detail: 'Signed in, Max plan.', fix: null }],
    });
    expect(imported.prompt?.choices.map((choice) => choice.value)).toEqual([
      'continue',
      'import:cswap:swap@example.com',
      'add',
      'recheck',
    ]);
    expect(done).toEqual(['login', 'import claude me@example.com']);
    const next = await choose(onboarding, 'accounts', 'continue');
    expect(next.prompt?.questionId).toBe('prerequisites');
  });

  test('a signed-out account is signed in again through Shinsa, never sent to a terminal', async () => {
    const { actions, done } = createActions();
    const signedOut: ClaudeAccount[] = [
      { id: 'a', signedIn: false, detail: 'Needs you to sign in again.', label: 'me@example.com' },
    ];
    const { onboarding } = setup({ accounts: [signedOut, signedOut, signedOut], accountActions: actions });
    const asked = await reachAccounts(onboarding);
    expect(asked.messages.at(-1)).toMatchObject({
      checks: [
        {
          id: 'a',
          ok: false,
          fix: 'Choose “Sign in again as me@example.com” below.',
        },
      ],
    });
    expect(asked.prompt?.choices.map((choice) => [choice.value, choice.label])).toContainEqual([
      'sign_in:a',
      'Sign in again as me@example.com',
    ]);
    const signing = await choose(onboarding, 'accounts', 'sign_in:a');
    expect(lastText(signing)).toStartWith(
      'Claude opened a browser window to sign in. Finish there, then choose Check again.'
    );
    expect(done).toEqual(['login a']);
  });

  test('an import that fails says why and keeps the question open', async () => {
    const { actions } = createActions();
    const { onboarding } = setup({
      accountActions: {
        ...actions,
        listImports: () => Promise.resolve([{ origin: 'cswap', email: 'broken@example.com', plan: null }]),
      },
    });
    await reachAccounts(onboarding);
    const failed = await choose(onboarding, 'accounts', 'import:cswap:broken@example.com');
    expect(failed.messages.at(-1)).toMatchObject({ problem: true });
    expect(lastText(failed)).toStartWith('It did not work.');
    expect(failed.prompt?.questionId).toBe('accounts');
  });
});
