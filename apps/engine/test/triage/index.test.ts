import { describe, expect, test } from 'bun:test';
import { createState, type ShinsaState, type Task } from '@shinsa/core';
import type { JsonSchema } from '../../src/agents/providers/index.ts';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import type { LocalRepo } from '../../src/repos/index.ts';
import { SHAPE_QUESTION } from '../../src/triage/decisions.ts';
import { resolveRepoProject, resolveTriage } from '../../src/triage/index.ts';
import { createRepo, createTask } from '../helpers/state.ts';

const LOCAL: LocalRepo[] = [
  { path: '/code/web', name: 'web', touchedAt: 2 },
  { path: '/code/api', name: 'api', touchedAt: 1 },
];

function answer(value: unknown): QuickJson {
  return <T>() => Promise.resolve(value as T);
}

const silent = answer(null);

function stateWith(patch: (state: ShinsaState) => void = () => undefined) {
  const state = createState();
  patch(state);
  return state;
}

const START_ONLY = { shape: false, start: true, priority: false };

function newTask(overrides: Partial<Task> = {}) {
  return createTask({
    id: 'new',
    repoId: null,
    branch: null,
    stage: 'triage',
    request: 'Fix the login button',
    ...overrides,
  });
}

describe('resolveTriage without the model', () => {
  test('with no repository anywhere the task is triaged with none', async () => {
    expect(await resolveTriage(stateWith(), newTask(), [], silent)).toMatchObject({ repoPath: null });
  });

  test('a small change binds no repository without the model, and gets a fix branch', async () => {
    expect(await resolveTriage(stateWith(), newTask(), LOCAL, silent)).toEqual({
      title: 'Fix the login button',
      repoPath: null,
      size: 'small',
      branch: 'fix/fix-the-login-button',
      waitsOn: [],
      shape: 'change',
      priority: 'normal',
      reasons: {},
    });
  });

  test('a spec request, a long request or a redesign is large and gets a feat branch', async () => {
    for (const overrides of [
      { planFirst: true },
      { request: 'x'.repeat(501) },
      { request: 'Redesign the settings\nwith tabs' },
    ]) {
      const triage = await resolveTriage(stateWith(), newTask(overrides), LOCAL, silent);
      expect(triage?.size).toBe('large');
      expect(triage?.branch.startsWith('feat/')).toBe(true);
    }
    expect((await resolveTriage(stateWith(), newTask({ request: '\n' }), LOCAL, silent))?.title).toBe(
      'Untitled task'
    );
    const attached = newTask({
      request:
        '<attachments>\n<attachment kind="file" display_name="crash.log" path="/d/crash.log" />\n</attachments>',
    });
    expect((await resolveTriage(stateWith(), attached, LOCAL, silent))?.title).toBe('crash.log');
  });

  test('a pinned repository or the directory shinsa do ran in wins', async () => {
    const pinned = stateWith((draft) => {
      draft.repos.r = createRepo({ id: 'r', path: '/code/api', name: 'api' });
    });
    expect((await resolveTriage(pinned, newTask({ repoId: 'r' }), LOCAL, silent))?.repoPath).toBe(
      '/code/api'
    );
    expect(
      (await resolveTriage(stateWith(), newTask({ origin: '/code/api/src' }), LOCAL, silent))?.repoPath
    ).toBe('/code/api');
  });

  test('repositories are listed by name, including ones outside the roots, with nothing on which was used last', async () => {
    const state = stateWith((draft) => {
      draft.repos.r1 = createRepo({ id: 'r1', path: '/code/api', name: 'api' });
      draft.repos.r2 = createRepo({ id: 'r2', path: '/elsewhere/tool', name: 'tool' });
      draft.tasks.t1 = createTask({ id: 't1', repoId: 'r1', updatedAt: 10 });
      draft.tasks.t2 = createTask({ id: 't2', repoId: 'r1', updatedAt: 5 });
      draft.tasks.t3 = createTask({ id: 't3', repoId: null, updatedAt: 20 });
    });
    const prompts: string[] = [];
    const recording: QuickJson = <T>(_system: string, prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve(null as T);
    };
    expect((await resolveTriage(state, newTask(), LOCAL, recording))?.repoPath).toBeNull();
    expect(prompts[0]).toContain(
      'Repositories:\n- api: /code/api\n- tool: /elsewhere/tool\n- web: /code/web'
    );
    expect(prompts[0]).not.toContain('recent');
    expect(prompts[0]).toContain('- t1: Fix the tab scroll (api, building)');
    expect(prompts[0]).toContain('- t3: Fix the tab scroll (no repository yet, building)');
    expect((await resolveTriage(stateWith(), newTask(), LOCAL, recording)) && prompts[1]).toContain('(none)');
  });
});

describe('resolveTriage with the model', () => {
  const state = stateWith((draft) => {
    draft.repos.r1 = createRepo({ id: 'r1', path: '/code/api', name: 'api' });
    draft.tasks.same = createTask({ id: 'same', repoId: 'r1' });
    draft.tasks.loose = createTask({ id: 'loose', repoId: null });
    draft.tasks.other = createTask({ id: 'other', repoId: 'r9' });
    draft.tasks.done = createTask({ id: 'done', repoId: 'r1', stage: 'merged' });
  });

  test('takes the title, repository, size, branch and dependencies it names', async () => {
    const triage = await resolveTriage(
      state,
      newTask({ auto: START_ONLY }),
      LOCAL,
      answer({
        title: '  Fix the login button on mobile  ',
        repo: 'api',
        size: 'large',
        branch: 'fix/login-mobile',
        waits_on: ['same', 'loose', 'other'],
      })
    );
    expect(triage).toMatchObject({
      title: 'Fix the login button on mobile',
      repoPath: '/code/api',
      size: 'large',
      branch: 'fix/login-mobile',
    });
    expect(triage?.waitsOn.map((task) => task.id)).toEqual(['same', 'loose']);
  });

  test('a dependency list that names anything but open tasks is refused whole', async () => {
    for (const waits_on of [['same', 'done'], ['same', 'new'], ['same', 7], 'same']) {
      const triage = await resolveTriage(
        state,
        newTask(),
        LOCAL,
        answer({ title: 'Fix it', repo: 'api', size: 'small', branch: 'fix/it', waits_on })
      );
      expect(triage?.waitsOn).toEqual([]);
    }
  });

  test('falls back field by field on anything malformed', async () => {
    const triage = await resolveTriage(
      state,
      newTask(),
      LOCAL,
      answer({ title: '   ', repo: 'unknown', size: 'huge', branch: 'Fix Login', waits_on: ['nope'] })
    );
    expect(triage).toMatchObject({
      title: 'Fix the login button',
      repoPath: null,
      size: 'small',
      branch: 'fix/fix-the-login-button',
      waitsOn: [],
    });
  });
});

describe('the branch triage names', () => {
  test('starts with a conventional commit type, or the fallback branch is used', async () => {
    const triage = await resolveTriage(
      stateWith(),
      newTask(),
      LOCAL,
      answer({ title: 'Fix it', repo: 'none', size: 'small', branch: 'feature/login', waits_on: [] })
    );
    expect(triage?.branch).toBe('fix/fix-the-login-button');
    const perf = await resolveTriage(
      stateWith(),
      newTask(),
      LOCAL,
      answer({ title: 'Fix it', repo: 'none', size: 'small', branch: 'perf/faster-list', waits_on: [] })
    );
    expect(perf?.branch).toBe('perf/faster-list');
  });

  test('the prompt and the schema list the same commit types', async () => {
    const calls: { system: string; schema: JsonSchema | undefined }[] = [];
    const ask: QuickJson = <T>(system: string, _prompt: string, schema?: JsonSchema) => {
      calls.push({ system, schema });
      return Promise.resolve(null as T);
    };
    await resolveTriage(stateWith(), newTask(), LOCAL, ask);
    expect(calls[0]?.system).toContain('type one of feat, fix, chore, refactor, docs, perf, test');
    expect(calls[0]?.schema?.properties.branch).toEqual({
      type: 'string',
      pattern: '^(feat|fix|chore|refactor|docs|perf|test)\\/[a-z0-9-]+$',
    });
  });

  test('a request to set up an automation, such as a watch, needs no repository and reads as an answer', async () => {
    const calls: { system: string; schema: JsonSchema | undefined }[] = [];
    const ask: QuickJson = <T>(system: string, _prompt: string, schema?: JsonSchema) => {
      calls.push({ system, schema });
      return Promise.resolve(null as T);
    };
    await resolveTriage(stateWith(), newTask(), LOCAL, ask);
    expect(calls[0]?.system).toContain('a request to set up a Shinsa automation');
    expect(calls[0]?.system).toContain('rather than code such as a cron job in a repository');
    expect(calls[0]?.system).toContain('“watch #feedback for bugs, hourly”');
    expect(SHAPE_QUESTION.criteria.answer).toContain(
      'so a cron job or a scheduler in a repository is a change'
    );
    expect(SHAPE_QUESTION.criteria.answer).toContain(
      'a request to set up a Shinsa automation (a schedule, a trigger or a watch of an integration) that its agent sets or suggests'
    );
  });
});

describe('resolveTriage with structured output', () => {
  test('size and waits_on are typed decisions: the schema offers exactly their options and the prompt names each', async () => {
    const state = stateWith((draft) => {
      draft.repos.r1 = createRepo({ id: 'r1', path: '/code/api', name: 'api' });
      draft.tasks.same = createTask({ id: 'same', repoId: 'r1', title: 'Add the export' });
      draft.tasks.done = createTask({ id: 'done', repoId: 'r1', stage: 'merged' });
    });
    const calls: { prompt: string; schema: JsonSchema | undefined }[] = [];
    const recording: QuickJson = <T>(_system: string, prompt: string, shape?: JsonSchema) => {
      calls.push({ prompt, schema: shape });
      return Promise.resolve({
        title: 'Fix it',
        repo: 'api',
        size: 'large',
        branch: 'fix/it',
        waits_on: ['same'],
      } as T);
    };
    const triage = await resolveTriage(state, newTask({ auto: START_ONLY }), LOCAL, recording);
    expect(triage).toMatchObject({ size: 'large', repoPath: '/code/api' });
    expect(triage?.waitsOn.map((task) => task.id)).toEqual(['same']);
    const schema = calls[0]?.schema;
    expect(schema?.properties.repo).toEqual({ type: 'string', enum: ['api', 'web', 'none'] });
    expect(schema?.properties.size).toEqual({ type: 'string', enum: ['small', 'large'] });
    expect(schema?.properties.waits_on).toEqual({
      type: 'array',
      items: { type: 'string', enum: ['same'] },
      uniqueItems: true,
    });
    expect(calls[0]?.prompt).toContain(
      'Decisions:\n- size (choice): How much agreement does the work need before building starts? Options: "small": a contained fix'
    );
    expect(calls[0]?.prompt).toContain(
      '- waits_on (choices): Which open tasks must be finished before this one can start? Often none.'
    );
    expect(calls[0]?.prompt).toContain('Options: "same": Add the export.');

    calls.length = 0;
    await resolveTriage(stateWith(), newTask({ auto: START_ONLY }), LOCAL, recording);
    expect(calls[0]?.schema?.properties.waits_on).toEqual({ type: 'array', maxItems: 0 });
    expect(calls[0]?.prompt).toContain('- waits_on (choices): ');
    expect(calls[0]?.prompt).toContain('There are no options.');
  });

  test('a question is titled by what it asks about, not as work to do', async () => {
    const prompts: string[] = [];
    const recording: QuickJson = <T>(_system: string, prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve(null as T);
    };
    await resolveTriage(
      stateWith(),
      newTask({ mode: 'ask', request: 'How does the export size chunks?' }),
      LOCAL,
      recording
    );
    await resolveTriage(stateWith(), newTask({ auto: START_ONLY }), LOCAL, recording);
    expect(prompts[0]).toContain('This request is a question to answer from the code, not work to do.');
    expect(prompts[1]).not.toContain('a question to answer');
  });

  test('a size that is not one of its options falls back to the heuristic', async () => {
    for (const size of ['huge', { choice: 'large' }, ['large']]) {
      const triage = await resolveTriage(
        stateWith(),
        newTask(),
        LOCAL,
        answer({ title: 'Fix it', repo: 'web', size, branch: 'fix/it', waits_on: [] })
      );
      expect(triage?.size).toBe('small');
    }
  });
});

describe('resolveTriage for what the task left to Shinsa', () => {
  const AUTO = { shape: true, start: true, priority: true };
  const state = stateWith((draft) => {
    draft.repos.r1 = createRepo({ id: 'r1', path: '/code/api', name: 'api' });
    draft.tasks.same = createTask({ id: 'same', repoId: 'r1', title: 'Add the export' });
  });

  function record(value: unknown) {
    const calls: { prompt: string; schema: JsonSchema | undefined }[] = [];
    const ask: QuickJson = <T>(_system: string, prompt: string, schema?: JsonSchema) => {
      calls.push({ prompt, schema });
      return Promise.resolve(value as T);
    };
    return { calls, ask };
  }

  test('without the model the kind, priority and start stay as they are, each with the reason why', async () => {
    expect(await resolveTriage(state, newTask({ auto: AUTO }), LOCAL, silent)).toMatchObject({
      shape: 'change',
      priority: 'normal',
      waitsOn: [],
      reasons: {
        shape: 'Shinsa could not classify the request, so it is treated as a change.',
        priority: 'Shinsa could not classify the request, so it keeps the normal priority.',
        start: 'Shinsa could not classify the request, so it starts without waiting on other tasks.',
      },
    });
    const question = await resolveTriage(
      state,
      newTask({ mode: 'ask', auto: { shape: true, start: false, priority: false } }),
      LOCAL,
      silent
    );
    expect(question).toMatchObject({
      shape: 'answer',
      reasons: { shape: 'Shinsa could not classify the request, so it is treated as a question.' },
    });
    expect(Object.keys(question?.reasons ?? {})).toEqual(['shape']);
  });

  test('the kind, priority and dependencies are typed decisions with their meanings and a reason each', async () => {
    const { calls, ask } = record({
      title: 'Find why the export is slow',
      repo: 'api',
      size: 'small',
      branch: 'fix/export-slow',
      shape: 'investigate',
      priority: 'high',
      waits_on: ['same'],
      shape_why: '  It asks why the export is slow, not for a change.  ',
      priority_why: 'x'.repeat(200),
      waits_on_why: 'It measures the export that task adds.',
    });
    const triage = await resolveTriage(state, newTask({ auto: AUTO }), LOCAL, ask);
    expect(triage).toMatchObject({
      shape: 'investigate',
      priority: 'high',
      reasons: {
        shape: 'It asks why the export is slow, not for a change.',
        priority: 'x'.repeat(120),
        start: 'It measures the export that task adds.',
      },
    });
    expect(triage?.waitsOn.map((task) => task.id)).toEqual(['same']);
    const schema = calls[0]?.schema;
    expect(schema?.properties.shape).toEqual({
      type: 'string',
      enum: ['answer', 'investigate', 'research', 'change', 'fix', 'operation'],
    });
    expect(schema?.properties.priority).toEqual({
      type: 'string',
      enum: ['urgent', 'high', 'normal', 'low'],
    });
    expect(schema?.properties.shape_why).toEqual({ type: 'string', maxLength: 120 });
    expect(schema?.required).toEqual([
      'title',
      'repo',
      'size',
      'branch',
      'shape',
      'priority',
      'waits_on',
      'shape_why',
      'priority_why',
      'waits_on_why',
    ]);
    const prompt = calls[0]?.prompt ?? '';
    expect(prompt).toContain('- shape (choice): What kind of task is this? Options: "answer": a question');
    expect(prompt).toContain('"operation": run a one-off action in the repository');
    expect(prompt).toContain('- priority (choice): How soon does this need doing');
    expect(prompt).toContain(
      'Then say why for each, in one plain sentence: shape_why, priority_why, waits_on_why.'
    );
    expect(prompt).not.toContain('The human chose');
  });

  test('a decision that is not one of its options keeps the task as it is, and a missing reason is filled in', async () => {
    const invalid = await resolveTriage(
      state,
      newTask({ auto: AUTO }),
      LOCAL,
      answer({
        title: 'Fix it',
        repo: 'api',
        size: 'small',
        branch: 'fix/it',
        shape: 'refactor',
        priority: 9,
      })
    );
    expect(invalid).toMatchObject({
      shape: 'change',
      priority: 'normal',
      waitsOn: [],
      reasons: {
        shape: 'Shinsa could not classify the request, so it is treated as a change.',
        priority: 'Shinsa could not classify the request, so it keeps the normal priority.',
        start: 'Shinsa could not classify the request, so it starts without waiting on other tasks.',
      },
    });
    const unexplained = await resolveTriage(
      state,
      newTask({ auto: AUTO }),
      LOCAL,
      answer({
        title: 'Fix it',
        repo: 'api',
        size: 'small',
        branch: 'fix/it',
        shape: 'fix',
        priority: 'low',
        waits_on: [],
        shape_why: '   ',
      })
    );
    expect(unexplained?.reasons).toEqual({
      shape: 'The request reads as a fix.',
      priority: 'The request reads as low priority work.',
      start: 'It does not need the work of another open task.',
    });
    const waiting = await resolveTriage(
      state,
      newTask({ auto: AUTO }),
      LOCAL,
      answer({ title: 'Fix it', repo: 'api', size: 'small', branch: 'fix/it', waits_on: ['same'] })
    );
    expect(waiting?.reasons?.start).toBe('It needs the work of another open task first.');
  });

  test('without a project, a dependency in another repository is dropped along with the reason the model gave for it', async () => {
    const triage = await resolveTriage(
      state,
      newTask({ auto: AUTO }),
      LOCAL,
      answer({
        title: 'Add the export button',
        repo: 'web',
        size: 'small',
        branch: 'feat/export-button',
        waits_on: ['same'],
        waits_on_why: 'It calls the endpoint that task adds.',
      })
    );
    expect(triage?.repoPath).toBe('/code/web');
    expect(triage?.waitsOn).toEqual([]);
    expect(triage?.reasons?.start).toBe('It does not need the work of another open task.');
  });

  test('what the human chose is stated and not asked again', async () => {
    const { calls, ask } = record({
      title: 'Where the export lives',
      repo: 'api',
      size: 'small',
      branch: 'docs/x',
    });
    const triage = await resolveTriage(
      state,
      newTask({
        pipeline: ['answer'],
        priority: 'high',
        waitsOn: ['same', 'gone'],
        auto: { shape: false, start: false, priority: false },
      }),
      LOCAL,
      ask
    );
    expect(triage).toMatchObject({ shape: 'answer', priority: 'high', waitsOn: [], reasons: {} });
    const prompt = calls[0]?.prompt ?? '';
    expect(prompt).toContain(
      'The human chose: the kind of task is answer; the priority is high; it waits for “Add the export”, “another task”.'
    );
    expect(prompt).toContain('This request is a question to answer from the code');
    expect(Object.keys(calls[0]?.schema?.properties ?? {})).toEqual(['title', 'repo', 'size', 'branch']);
    expect(prompt).not.toContain('waits_on');

    await resolveTriage(state, newTask({ auto: { shape: true, start: false, priority: true } }), LOCAL, ask);
    expect(calls[1]?.prompt).toContain('The human chose: it starts now.');
    await resolveTriage(state, newTask({ mode: 'ask', auto: AUTO }), LOCAL, ask);
    expect(calls[2]?.prompt).not.toContain('a question to answer');
  });
});

describe('triage in a project', () => {
  const PROJECT = { id: 'p1', name: 'Basket', color: 'blue', key: 'BAS', description: '', folders: [] };

  function recording() {
    const prompts: string[] = [];
    const ask: QuickJson = <T>(_system: string, prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve(null as T);
    };
    return { prompts, ask };
  }

  test('only the project’s repositories are offered, with the project named', async () => {
    const state = stateWith((draft) => {
      draft.projects.p1 = { ...PROJECT, description: 'Shopping app' } as ShinsaState['projects'][string];
      draft.repos.r1 = createRepo({ id: 'r1', name: 'server', path: '/basket/server', projectId: 'p1' });
      draft.repos.r2 = createRepo({ id: 'r2', name: 'elsewhere', path: '/code/elsewhere' });
    });
    const { prompts, ask } = recording();
    const result = await resolveTriage(state, newTask({ projectId: 'p1' }), LOCAL, ask);
    expect(result?.repoPath).toBeNull();
    expect(prompts[0]).toContain(
      'Project:\n- name: Basket\n- key: BAS\n- description: Shopping app\nOther repositories on the machine outside this project, never offered: api, elsewhere, web. A request that names one of them gets "none".\n\nRepositories:\n- server: /basket/server\n\n'
    );
  });

  test('a project with no repository yet offers every repository on the machine and says so', async () => {
    const state = stateWith((draft) => {
      draft.projects.p1 = PROJECT as ShinsaState['projects'][string];
    });
    const { prompts, ask } = recording();
    const result = await resolveTriage(state, newTask({ projectId: 'p1' }), LOCAL, ask);
    expect(result?.repoPath).toBeNull();
    expect(prompts[0]).toContain(
      'Project:\n- name: Basket\n- key: BAS\nThe project has no repository yet, so every repository on the machine is offered.\n'
    );
    expect(prompts[0]).toContain('- api: /code/api\n- web: /code/web');
  });

  test('a dependency anywhere in the project is offered and kept, and tasks of other projects are not offered', async () => {
    const state = stateWith((draft) => {
      draft.projects.p1 = PROJECT as ShinsaState['projects'][string];
      draft.projects.p2 = {
        ...PROJECT,
        id: 'p2',
        name: 'Other',
        key: 'OTH',
      } as ShinsaState['projects'][string];
      draft.repos.r1 = createRepo({ id: 'r1', name: 'api', path: '/basket/api', projectId: 'p1' });
      draft.repos.r2 = createRepo({ id: 'r2', name: 'web', path: '/basket/web', projectId: 'p1' });
      draft.repos.r3 = createRepo({ id: 'r3', name: 'site', path: '/other/site', projectId: 'p2' });
      draft.tasks.backend = createTask({ id: 'backend', repoId: 'r1', title: 'Add the export endpoint' });
      draft.tasks.unfiled = createTask({
        id: 'unfiled',
        repoId: null,
        projectId: 'p1',
        title: 'Plan the export',
      });
      draft.tasks.elsewhere = createTask({ id: 'elsewhere', repoId: 'r3', title: 'Redo the site' });
    });
    const prompts: string[] = [];
    const ask: QuickJson = <T>(_system: string, prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve({
        title: 'Add the export button',
        repo: 'web',
        size: 'small',
        branch: 'feat/export-button',
        waits_on: ['backend', 'unfiled'],
        waits_on_why: 'It calls the endpoint that task adds.',
      } as T);
    };
    const triage = await resolveTriage(
      state,
      newTask({ projectId: 'p1', auto: { shape: false, priority: false, start: true } }),
      LOCAL,
      ask
    );
    expect(triage?.repoPath).toBe('/basket/web');
    expect(triage?.waitsOn.map((task) => task.id)).toEqual(['backend', 'unfiled']);
    expect(triage?.reasons?.start).toBe('It calls the endpoint that task adds.');
    expect(prompts[0]).toContain('- backend: Add the export endpoint (api, ');
    expect(prompts[0]).not.toContain('Redo the site');
  });

  test('a project that no longer exists is triaged like a task without one', async () => {
    const { prompts, ask } = recording();
    await resolveTriage(stateWith(), newTask({ projectId: 'gone' }), LOCAL, ask);
    expect(prompts[0]).not.toContain('Project:');
  });
});

describe('triage may choose no repository', () => {
  const SHINSA_PROJECT = {
    id: 'p1',
    name: 'Shinsa',
    color: 'blue',
    key: 'SW',
    description: '',
    folders: [],
  } as ShinsaState['projects'][string];
  const KANNA: LocalRepo[] = [
    { path: '/code/shinsa', name: 'shinsa', touchedAt: 2 },
    { path: '/code/kanna', name: 'kanna', touchedAt: 1 },
  ];

  function recordAnswer(repo: string) {
    const calls: { system: string; schema: JsonSchema | undefined }[] = [];
    const ask: QuickJson = <T>(system: string, _prompt: string, schema?: JsonSchema) => {
      calls.push({ system, schema });
      return Promise.resolve({ title: 'Hey', repo, size: 'small', branch: 'chore/hey' } as T);
    };
    return { calls, ask };
  }

  test('a greeting binds no repository, even when the project has only one', async () => {
    const { calls, ask } = recordAnswer('none');
    const triage = await resolveTriage(stateWith(), newTask({ request: 'Hey' }), KANNA.slice(0, 1), ask);
    expect(triage.repoPath).toBeNull();
    expect(calls[0]?.schema?.properties.repo).toEqual({ type: 'string', enum: ['shinsa', 'none'] });
    expect(calls[0]?.system).toContain('Answer "none" when the request needs no repository: a greeting');
    expect(calls[0]?.system).toContain('Never pick a repository only because it is the only one listed');
  });

  test('a request that names a repository binds it', async () => {
    const triage = await resolveTriage(
      stateWith(),
      newTask({ request: 'Fix the button in kanna' }),
      KANNA,
      recordAnswer('kanna').ask
    );
    expect(triage.repoPath).toBe('/code/kanna');
  });

  test('a repository outside the task’s project is offered when the request names it, and binds', async () => {
    const state = stateWith((draft) => {
      draft.projects.p1 = SHINSA_PROJECT;
      draft.repos.r1 = createRepo({ id: 'r1', name: 'shinsa', path: '/code/shinsa', projectId: 'p1' });
    });
    const calls: { system: string; prompt: string; schema: JsonSchema | undefined }[] = [];
    const ask: QuickJson = <T>(system: string, prompt: string, schema?: JsonSchema) => {
      calls.push({ system, prompt, schema });
      return Promise.resolve({
        title: 'Fix the button',
        repo: 'kanna',
        size: 'small',
        branch: 'fix/button',
      } as T);
    };
    for (const request of [
      'Fix the button in kanna',
      'Fix the button in Kanna’s sidebar',
      'KANNA: fix the button',
    ]) {
      const triage = await resolveTriage(state, newTask({ projectId: 'p1', request }), KANNA, ask);
      expect(triage.repoPath).toBe('/code/kanna');
    }
    expect(calls[0]?.schema?.properties.repo).toEqual({ type: 'string', enum: ['shinsa', 'kanna', 'none'] });
    expect(calls[0]?.prompt).toContain(
      'Repositories outside this project, offered because the request names them: kanna. Pick one only for the work the request names it for; the task stays in this project.'
    );
    expect(calls[0]?.prompt).not.toContain('never offered');
    expect(calls[0]?.system).toContain('A request that names a repository that is not listed gets "none".');
  });

  test('an outside repository the request does not name is never offered, so picking it binds none', async () => {
    const state = stateWith((draft) => {
      draft.projects.p1 = SHINSA_PROJECT;
      draft.repos.r1 = createRepo({ id: 'r1', name: 'shinsa', path: '/code/shinsa', projectId: 'p1' });
    });
    const local: LocalRepo[] = [...KANNA, { path: '/code/paywall-next', name: 'paywall-next', touchedAt: 0 }];
    const { calls, ask } = recordAnswer('kanna');
    const vague = await resolveTriage(
      state,
      newTask({ projectId: 'p1', request: 'Fix the kannabis typo in paywall next' }),
      local,
      ask
    );
    expect(vague.repoPath).toBeNull();
    expect(calls[0]?.schema?.properties.repo).toEqual({
      type: 'string',
      enum: ['shinsa', 'paywall-next', 'none'],
    });
  });

  test('a vague request names no repository: no recency hint, no guess, and the setup gate asks', async () => {
    const state = stateWith((draft) => {
      draft.repos.r1 = createRepo({ id: 'r1', name: 'shinsa', path: '/code/shinsa' });
      draft.tasks.recent = createTask({ id: 'recent', repoId: 'r1', updatedAt: 99 });
    });
    const calls: { system: string; prompt: string }[] = [];
    const ask: QuickJson = <T>(system: string, prompt: string) => {
      calls.push({ system, prompt });
      return Promise.resolve(null as T);
    };
    const triage = await resolveTriage(
      state,
      newTask({ request: 'Make the answer a doc in the repo' }),
      KANNA,
      ask
    );
    expect(triage.repoPath).toBeNull();
    expect(calls[0]?.system).toContain(
      'Never pick a repository only because it is the only one listed or because it was worked on recently'
    );
    expect(calls[0]?.system).toContain('"The repo", "the code" or "the project" alone names none.');
    expect(calls[0]?.system).not.toContain('Prefer');
    expect(calls[0]?.prompt).toContain('Repositories:\n- kanna: /code/kanna\n- shinsa: /code/shinsa');
  });

  test('a pinned repository is never dropped, and the directory a task started in can be', async () => {
    const pinned = stateWith((draft) => {
      draft.repos.r = createRepo({ id: 'r', path: '/code/kanna', name: 'kanna' });
    });
    const { calls, ask } = recordAnswer('none');
    expect((await resolveTriage(pinned, newTask({ repoId: 'r' }), KANNA, ask)).repoPath).toBe('/code/kanna');
    expect(calls[0]?.schema?.properties.repo).toEqual({ type: 'string', enum: ['kanna'] });
    const origin = newTask({ origin: '/code/kanna/src' });
    expect((await resolveTriage(stateWith(), origin, KANNA, ask)).repoPath).toBeNull();
    expect(calls[1]?.schema?.properties.repo).toEqual({ type: 'string', enum: ['kanna', 'none'] });
  });
});

describe('the project a repository triage registers goes to', () => {
  function project(id: string, folders: string[] = []) {
    return {
      id,
      name: id,
      color: 'blue',
      key: id.toUpperCase(),
      description: '',
      folders,
    } as ShinsaState['projects'][string];
  }

  test('the project whose folder holds it, else the task’s project while it has no repository, else none', () => {
    const state = stateWith((draft) => {
      draft.projects.full = project('full');
      draft.projects.empty = project('empty');
      draft.projects.home = project('home', ['/code/home']);
      draft.repos.r1 = createRepo({ id: 'r1', name: 'shinsa', path: '/code/shinsa', projectId: 'full' });
    });
    expect(resolveRepoProject(state, newTask({ projectId: 'full' }), '/code/home/site')).toBe('home');
    expect(resolveRepoProject(state, newTask({ projectId: 'empty' }), '/code/kanna')).toBe('empty');
    expect(resolveRepoProject(state, newTask({ projectId: 'full' }), '/code/kanna')).toBeNull();
    expect(resolveRepoProject(state, newTask(), '/code/kanna')).toBeNull();
  });
});
