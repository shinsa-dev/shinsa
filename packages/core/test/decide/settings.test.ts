import { describe, expect, test } from 'bun:test';
import { PROJECT_LIMITS, resolveQueue } from '../../src/index.ts';
import { createHarness, createTask, type Harness, registerRepo } from '../harness.ts';

function registerAt(
  harness: Harness,
  path: string,
  options: { projectName?: string | null; projectId?: string | null } = {}
) {
  const name = path.split('/').at(-1) ?? path;
  harness.send({
    type: 'repo.register',
    repo: { name, path, defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName: options.projectName ?? null,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
  });
  return Object.values(harness.state.repos).find((repo) => repo.path === path)?.id ?? '';
}

function writeProject(
  harness: Harness,
  project: { id?: string; name: string; key?: string; description?: string; folders?: string[] }
) {
  harness.send({ type: 'project.write', project: { color: 'blue', ...project } });
  return Object.values(harness.state.projects).find((entry) => entry.name === project.name.trim());
}

describe('repositories', () => {
  test('registering repositories files them into a project by name, matched without case', () => {
    const harness = createHarness();
    registerRepo(harness);
    registerRepo(harness, 'paywall-editor', 'superwall');
    const projects = Object.values(harness.state.projects);
    expect(projects).toEqual([
      {
        id: projects[0]?.id ?? '',
        name: 'Superwall',
        color: 'blue',
        key: 'SUP',
        description: '',
        folders: [],
      },
    ]);
    expect(Object.values(harness.state.repos).every((repo) => repo.projectId === projects[0]?.id)).toBe(true);
  });

  test('a repository is registered once per path, and without a project name it has no project', () => {
    const harness = createHarness();
    registerRepo(harness, 'shinsa', null);
    const events = harness.state.seq;
    registerRepo(harness, 'shinsa', 'Personal');
    expect(harness.state.seq).toBe(events);
    expect(Object.values(harness.state.repos)).toMatchObject([{ name: 'shinsa', projectId: null }]);
  });

  test('a project made for a repository gets the next color and a key of its own', () => {
    const harness = createHarness();
    registerRepo(harness, 'a', 'Superwall');
    registerRepo(harness, 'b', 'Superbase');
    expect(Object.values(harness.state.projects).map(({ color, key }) => ({ color, key }))).toEqual([
      { color: 'blue', key: 'SUP' },
      { color: 'purple', key: 'SU' },
    ]);
  });

  test('a repository goes into the project it names, before any folder or name', () => {
    const harness = createHarness();
    const basket = writeProject(harness, { name: 'Basket' });
    writeProject(harness, { name: 'Superwall', folders: ['/code/superwall'] });
    const repoId = registerAt(harness, '/code/superwall/app', {
      projectId: basket?.id ?? '',
      projectName: 'Personal',
    });
    expect(harness.state.repos[repoId]?.projectId).toBe(basket?.id ?? '');
  });

  test('a repository named into a project that is gone is filed by its folder instead', () => {
    const harness = createHarness();
    const superwall = writeProject(harness, { name: 'Superwall', folders: ['/code/superwall'] });
    const repoId = registerAt(harness, '/code/superwall/app', { projectId: 'gone', projectName: 'Personal' });
    expect(harness.state.repos[repoId]?.projectId).toBe(superwall?.id ?? '');
  });

  test('a repository inside nested project folders goes to the project of the longest folder', () => {
    const harness = createHarness();
    writeProject(harness, { name: 'Code', folders: ['/code'] });
    const sdk = writeProject(harness, { name: 'Basket SDK', key: 'BSDK', folders: ['/code/basket/sdk'] });
    const repoId = registerAt(harness, '/code/basket/sdk/ios', { projectName: 'Basket' });
    expect(harness.state.repos[repoId]?.projectId).toBe(sdk?.id ?? '');
    expect(Object.values(harness.state.projects).map((project) => project.name)).toEqual([
      'Code',
      'Basket SDK',
    ]);
  });

  test('a folder is matched as a whole path, so a sibling with the same prefix is not inside it', () => {
    const harness = createHarness();
    writeProject(harness, { name: 'Basket', folders: ['/code/basket'] });
    const repoId = registerAt(harness, '/code/basket-old/app');
    expect(harness.state.repos[repoId]?.projectId).toBeNull();
  });

  test('updating a repository changes only what the patch names, and only when something changes', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'repo.update', repoId, patch: { checkCommands: ['bun test'] } });
    expect(harness.state.repos[repoId]).toMatchObject({ name: 'paywall-next', checkCommands: ['bun test'] });
    const events = harness.state.seq;
    harness.send({ type: 'repo.update', repoId, patch: { checkCommands: ['bun test'] } });
    expect(harness.state.seq).toBe(events);
  });

  test('a repository moves to another project, or out of every project', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const basket = writeProject(harness, { name: 'Basket' });
    harness.send({ type: 'repo.update', repoId, patch: { projectId: basket?.id ?? '' } });
    expect(harness.state.repos[repoId]?.projectId).toBe(basket?.id ?? '');
    harness.send({ type: 'repo.update', repoId, patch: { projectId: null } });
    expect(harness.state.repos[repoId]?.projectId).toBeNull();
  });

  test('a repository update must name a repository and a project that exist', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    expect(() => harness.send({ type: 'repo.update', repoId: 'nope', patch: {} })).toThrow(
      'No repository nope'
    );
    expect(() => harness.send({ type: 'repo.update', repoId, patch: { projectId: 'nope' } })).toThrow(
      'No project nope'
    );
  });

  test('removing a repository is idempotent', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'repo.remove', repoId });
    const events = harness.state.seq;
    harness.send({ type: 'repo.remove', repoId });
    expect(harness.state.repos).toEqual({});
    expect(harness.state.seq).toBe(events);
  });
});

describe('projects', () => {
  test('writing a project trims its name and description and skips a write that changes nothing', () => {
    const harness = createHarness();
    harness.send({
      type: 'project.write',
      project: { name: '  Work ', color: 'blue', description: ' The day job. ' },
    });
    const [id = ''] = Object.keys(harness.state.projects);
    expect(harness.state.projects[id]).toEqual({
      id,
      name: 'Work',
      color: 'blue',
      key: 'WOR',
      description: 'The day job.',
      folders: [],
    });
    const events = harness.state.seq;
    harness.send({ type: 'project.write', project: { id, name: 'Work', color: 'blue' } });
    expect(harness.state.seq).toBe(events);
    harness.send({ type: 'project.write', project: { id, name: 'Work', color: 'green' } });
    expect(harness.state.projects[id]).toMatchObject({
      color: 'green',
      key: 'WOR',
      description: 'The day job.',
    });
  });

  test('a new project gets an id, and a project needs a name of at most the name limit', () => {
    const harness = createHarness();
    harness.send({ type: 'project.write', project: { name: 'Side', color: 'pink' } });
    expect(Object.values(harness.state.projects)).toMatchObject([{ name: 'Side', color: 'pink' }]);
    expect(() => harness.send({ type: 'project.write', project: { name: '  ', color: 'pink' } })).toThrow(
      'Name the project.'
    );
    expect(() =>
      harness.send({
        type: 'project.write',
        project: { name: 'x'.repeat(PROJECT_LIMITS.name + 1), color: 'pink' },
      })
    ).toThrow(`A project name is at most ${PROJECT_LIMITS.name} characters.`);
  });

  test('a key is derived from the name, and renaming a project keeps its key', () => {
    const harness = createHarness();
    const id = writeProject(harness, { name: 'Superwall Web' })?.id ?? '';
    expect(harness.state.projects[id]?.key).toBe('SW');
    writeProject(harness, { id, name: 'Paywalls' });
    expect(harness.state.projects[id]?.key).toBe('SW');
    expect(writeProject(harness, { name: 'Superwall Wiki' })?.key).toBe('SUP');
  });

  test('an explicit key is trimmed and upper-cased', () => {
    const harness = createHarness();
    expect(writeProject(harness, { name: 'Basket', key: ' bsk ' })?.key).toBe('BSK');
  });

  test('a key that is not 2 to 6 letters or digits starting with a letter is refused', () => {
    const harness = createHarness();
    for (const key of ['B', '9AB', 'TOOLONGX', 'B-K']) {
      expect(() => writeProject(harness, { name: 'Basket', key })).toThrow(
        'A project key is 2 to 6 letters or digits and starts with a letter, like SW.'
      );
    }
    expect(harness.state.projects).toEqual({});
  });

  test('a key another project uses is refused, but a project may keep its own', () => {
    const harness = createHarness();
    const id = writeProject(harness, { name: 'Superwall', key: 'SW' })?.id ?? '';
    expect(() => writeProject(harness, { name: 'Switch', key: 'sw' })).toThrow(
      'Another project already uses the key SW.'
    );
    writeProject(harness, { id, name: 'Superwall', key: 'SW', description: 'Paywalls.' });
    expect(harness.state.projects[id]).toMatchObject({ key: 'SW', description: 'Paywalls.' });
  });

  test('a description longer than the limit is refused', () => {
    const harness = createHarness();
    expect(() =>
      writeProject(harness, { name: 'Basket', description: 'x'.repeat(PROJECT_LIMITS.description + 1) })
    ).toThrow(`A project description is at most ${PROJECT_LIMITS.description} characters.`);
  });

  test('folders are trimmed, lose a trailing slash, and are kept once', () => {
    const harness = createHarness();
    const project = writeProject(harness, {
      name: 'Superwall',
      folders: [' /code/superwall/ ', '/code/superwall', '', '/code/sdk//'],
    });
    expect(project?.folders).toEqual(['/code/superwall', '/code/sdk']);
    writeProject(harness, { id: project?.id ?? '', name: 'Superwall', description: 'Paywalls.' });
    expect(harness.state.projects[project?.id ?? '']?.folders).toEqual(['/code/superwall', '/code/sdk']);
  });

  test('a folder must be a full path', () => {
    const harness = createHarness();
    expect(() => writeProject(harness, { name: 'Basket', folders: ['~/code/basket'] })).toThrow(
      '“~/code/basket” is not a full folder path.'
    );
    expect(() =>
      writeProject(harness, { name: 'Basket', folders: [`/${'x'.repeat(PROJECT_LIMITS.folder)}`] })
    ).toThrow('is not a full folder path.');
  });

  test('a folder another project has is refused', () => {
    const harness = createHarness();
    writeProject(harness, { name: 'Superwall', folders: ['/code/superwall'] });
    expect(() => writeProject(harness, { name: 'Basket', folders: ['/code/superwall/'] })).toThrow(
      '“/code/superwall” already belongs to the project Superwall.'
    );
  });

  test('a project has at most the folder limit', () => {
    const harness = createHarness();
    const folders = Array.from({ length: PROJECT_LIMITS.folders + 1 }, (_, index) => `/code/${index}`);
    expect(() => writeProject(harness, { name: 'Basket', folders })).toThrow(
      `A project can have at most ${PROJECT_LIMITS.folders} folders.`
    );
  });

  test('adding a folder moves the registered repositories inside it into the project', () => {
    const harness = createHarness();
    const app = registerAt(harness, '/code/basket/app', { projectName: 'Personal' });
    const server = registerAt(harness, '/code/basket/server');
    const outside = registerAt(harness, '/code/notes');
    const basket = writeProject(harness, { name: 'Basket', folders: ['/code/basket'] });
    expect(harness.state.repos[app]?.projectId).toBe(basket?.id ?? '');
    expect(harness.state.repos[server]?.projectId).toBe(basket?.id ?? '');
    expect(harness.state.repos[outside]?.projectId).toBeNull();
    expect(harness.events.filter((event) => event.type === 'repo.updated')).toHaveLength(2);
  });

  test('a repository inside a deeper folder of another project stays where it is', () => {
    const harness = createHarness();
    const sdk = writeProject(harness, { name: 'Basket SDK', key: 'BSDK', folders: ['/code/basket/sdk'] });
    const repoId = registerAt(harness, '/code/basket/sdk/ios');
    writeProject(harness, { name: 'Code', folders: ['/code'] });
    expect(harness.state.repos[repoId]?.projectId).toBe(sdk?.id ?? '');
  });

  test('removing the focused project frees its repositories and clears the focus, so nothing hides', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness, 'paywall-next', 'Superwall');
    const projectId = harness.state.repos[repoId]?.projectId ?? '';
    const other = registerRepo(harness, 'shinsa', 'Personal');
    harness.send({ type: 'focus.change', projectId, until: null });
    createTask(harness, { repoId });
    harness.send({ type: 'project.remove', projectId });
    expect(harness.state.projects[projectId]).toBeUndefined();
    expect(harness.state.repos[repoId]?.projectId).toBeNull();
    expect(harness.state.repos[other]?.projectId).not.toBeNull();
    expect(harness.state.focus).toEqual({ projectId: null, until: null });
    expect(harness.lastEffect('briefing.request').projectId).toBeNull();
    expect(resolveQueue(harness.state, 0).working).toHaveLength(1);
  });

  test('removing a project that is not focused leaves the focus alone, and a missing project is a no-op', () => {
    const harness = createHarness();
    registerRepo(harness, 'a', 'One');
    const [one] = Object.keys(harness.state.projects);
    const two = writeProject(harness, { name: 'Two' })?.id ?? '';
    harness.send({ type: 'focus.change', projectId: two, until: null });
    harness.send({ type: 'project.remove', projectId: one ?? '' });
    expect(harness.state.focus.projectId).toBe(two);
    const events = harness.state.seq;
    harness.send({ type: 'project.remove', projectId: 'gone' });
    expect(harness.state.seq).toBe(events);
  });
});

describe('focus', () => {
  test('focusing asks for a new guide, and focusing the same way twice does nothing', () => {
    const harness = createHarness();
    const work = writeProject(harness, { name: 'Work' })?.id ?? '';
    harness.send({ type: 'focus.change', projectId: work, until: 9_000 });
    expect(harness.state.focus).toEqual({ projectId: work, until: 9_000 });
    expect(harness.lastEffect('briefing.request').projectId).toBe(work);
    const events = harness.state.seq;
    harness.send({ type: 'focus.change', projectId: work, until: 9_000 });
    expect(harness.state.seq).toBe(events);
  });

  test('focus must name a project that exists', () => {
    const harness = createHarness();
    expect(() => harness.send({ type: 'focus.change', projectId: 'nope', until: null })).toThrow(
      'No project nope'
    );
  });
});

describe('settings', () => {
  test('a patch merges into the settings, and an unchanged patch writes nothing', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 3, mergeMethod: 'rebase' } });
    expect(harness.state.settings).toMatchObject({
      maxFixRounds: 3,
      mergeMethod: 'rebase',
      defaultProvider: 'claude',
    });
    const events = harness.state.seq;
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 3 } });
    harness.send({ type: 'settings.change', patch: {} });
    expect(harness.state.seq).toBe(events);
    harness.send({ type: 'settings.change', patch: { maxFixRounds: null } });
    expect(harness.state.settings.maxFixRounds).toBeNull();
  });

  test('counts must be whole numbers of one or more', () => {
    const harness = createHarness();
    for (const patch of [{ maxFixRounds: 0 }, { maxFixRounds: 1.5 }, { attentionLimit: 0 }]) {
      expect(() => harness.send({ type: 'settings.change', patch })).toThrow('must be a whole number');
    }
    expect(harness.state.seq).toBe(0);
  });

  test('accounts switch at a whole percentage from 1 to 100', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { accountSwitchAt: 95 } });
    expect(harness.state.settings.accountSwitchAt).toBe(95);
    for (const accountSwitchAt of [0, 101, 90.5]) {
      expect(() => harness.send({ type: 'settings.change', patch: { accountSwitchAt } })).toThrow(
        'Switch accounts at a whole percentage from 1 to 100.'
      );
    }
  });

  test('idle compaction starts 1 to 30 minutes before the cache expires', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { idleCompaction: false, compactionLeadMinutes: 5 } });
    expect(harness.state.settings).toMatchObject({ idleCompaction: false, compactionLeadMinutes: 5 });
    for (const lead of [0, 31, 2.5]) {
      expect(() => harness.send({ type: 'settings.change', patch: { compactionLeadMinutes: lead } })).toThrow(
        'Compact from 1 to 30 minutes before the cache expires.'
      );
    }
  });

  test('picking a compaction and fast mode is recorded once, and again only when it changes', () => {
    const harness = createHarness();
    expect(harness.state.settings).toMatchObject({ compaction: 'eunoe_compact', fastMode: false });
    expect(harness.state.settings.idleCompaction).toBeUndefined();
    harness.send({ type: 'settings.change', patch: { compaction: 'claude', fastMode: true } });
    expect(harness.state.settings).toMatchObject({ compaction: 'claude', fastMode: true });
    const seq = harness.state.seq;
    harness.send({ type: 'settings.change', patch: { compaction: 'claude' } });
    expect(harness.state.seq).toBe(seq);
  });

  test('fast mode per role is recorded as the map you send, and sending the same map again does nothing', () => {
    const harness = createHarness();
    expect(harness.state.settings.agentFastModes).toEqual({});
    harness.send({ type: 'settings.change', patch: { agentFastModes: { agent: true } } });
    harness.send({ type: 'settings.change', patch: { agentFastModes: { agent: true, reviewer: false } } });
    expect(harness.state.settings.agentFastModes).toEqual({ agent: true, reviewer: false });
    expect(harness.state.settings.fastMode).toBe(false);
    const seq = harness.state.seq;
    harness.send({ type: 'settings.change', patch: { agentFastModes: { agent: true, reviewer: false } } });
    expect(harness.state.seq).toBe(seq);
    harness.send({ type: 'settings.change', patch: { agentFastModes: { reviewer: false } } });
    expect(harness.state.settings.agentFastModes).toEqual({ reviewer: false });
  });

  test('moving a role to another provider drops the model it had on the old one', () => {
    const harness = createHarness();
    harness.send({
      type: 'settings.change',
      patch: { agentModels: { reviewer: 'sonnet', agent: 'fable' } },
    });
    harness.send({ type: 'settings.change', patch: { agentProviders: { reviewer: 'codex' } } });
    expect(harness.state.settings.agentModels).toEqual({ agent: 'fable' });
    harness.send({
      type: 'settings.change',
      patch: {
        agentProviders: { reviewer: 'codex', agent: 'codex' },
        agentModels: { agent: 'gpt-5.6-sol' },
      },
    });
    expect(harness.state.settings.agentModels).toEqual({ agent: 'gpt-5.6-sol' });
  });

  test('switching the default provider clears the default model unless the same change names one', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { defaultProvider: 'codex' } });
    expect(harness.state.settings.defaultModel).toBeNull();
    harness.send({
      type: 'settings.change',
      patch: { defaultProvider: 'claude', defaultModel: 'sonnet' },
    });
    expect(harness.state.settings).toMatchObject({ defaultProvider: 'claude', defaultModel: 'sonnet' });
  });

  test('each step runs on the provider and model set for its role', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { agentProviders: { agent: 'codex' } } });
    const taskId = createTask(harness);
    expect(harness.activeRun(taskId)).toMatchObject({ provider: 'codex', model: 'gpt-6-astra' });
  });
});

describe('the guide', () => {
  test('a written guide is stored per project, with its structure when there is one', () => {
    const harness = createHarness();
    const briefing = { now: null, next: [], running: 'No agent is working right now.', note: null };
    harness.send({ type: 'briefing.write', projectId: null, text: 'Nothing needs you.', briefing });
    harness.send({ type: 'briefing.write', projectId: 'work', text: 'Plain.' });
    expect(harness.state.briefings['*']?.briefing).toEqual(briefing);
    expect(harness.state.briefings.work).toMatchObject({ text: 'Plain.', briefing: null });
  });
});
