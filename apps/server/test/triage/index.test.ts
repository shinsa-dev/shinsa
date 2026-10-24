import { describe, expect, test } from 'bun:test';
import { createState, type ShinsaState, type Task } from '@shinsa/core';
import type { JsonSchema } from '../../src/agents/providers/index.ts';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import type { LocalRepo } from '../../src/repos/index.ts';
import { resolveTriage } from '../../src/triage/index.ts';
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
  test('there is nothing to do without a repository', async () => {
    expect(await resolveTriage(stateWith(), newTask(), [], silent)).toBeNull();
  });

  test('a small change goes to the most recent repository on a fix branch', async () => {
    expect(await resolveTriage(stateWith(), newTask(), LOCAL, silent)).toEqual({
      title: 'Fix the login button',
      repoPath: '/code/web',
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

  test('repositories Shinsa worked in recently come first, including ones outside the roots', async () => {
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
    expect((await resolveTriage(state, newTask(), LOCAL, recording))?.repoPath).toBe('/code/api');
    expect(prompts[0]).toContain(
      'Repositories, most recently worked on first:\n- api: /code/api\n- web: /code/web\n- tool: /elsewhere/tool'
    );
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
      repoPath: '/code/api',
      size: 'small',
      branch: 'fix/fix-the-login-button',
      waitsOn: [],
    });
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
    expect(schema?.properties.repo).toEqual({ type: 'string', enum: ['api', 'web'] });
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
    expect(result?.repoPath).toBe('/basket/server');
    expect(prompts[0]).toContain(
      'Project:\n- name: Basket\n- key: BAS\n- description: Shopping app\n\nRepositories, most recently worked on first:\n- server: /basket/server\n\n'
    );
  });

  test('a project with no repository yet offers every repository on the machine and says so', async () => {
    const state = stateWith((draft) => {
      draft.projects.p1 = PROJECT as ShinsaState['projects'][string];
    });
    const { prompts, ask } = recording();
    const result = await resolveTriage(state, newTask({ projectId: 'p1' }), LOCAL, ask);
    expect(result?.repoPath).toBe('/code/web');
    expect(prompts[0]).toContain(
      'Project:\n- name: Basket\n- key: BAS\nThe project has no repository yet, so every repository on the machine is offered.\n'
    );
    expect(prompts[0]).toContain('- web: /code/web\n- api: /code/api');
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
