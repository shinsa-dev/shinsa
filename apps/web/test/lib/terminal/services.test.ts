import { describe, expect, it, spyOn } from 'bun:test';
import { resolveServiceView, SERVICE_LIMITS, type Task } from '@shinsa/core';
import {
  canStartAll,
  createServiceDraft,
  describeAddServices,
  describeNoSuggestions,
  describeRemoveServices,
  describeServiceClose,
  describeServiceFolder,
  describeServiceGroup,
  describeServicePreview,
  describeServiceState,
  describeServicesAdded,
  describeServicesEmpty,
  describeServicesRemove,
  describeServicesTrigger,
  describeStartAll,
  describeTaskRunLabel,
  describeTaskServices,
  describeTaskServicesFact,
  listAllPicks,
  listPickedInputs,
  listProjectServiceRuns,
  listRecommendedPicks,
  listServiceFolders,
  listServiceGroups,
  listServicePlaces,
  listStoppedServices,
  openServicePreview,
  parseServiceEnv,
  resolveActiveService,
  resolveServiceForm,
  resolveServiceGroupId,
  resolveServicesAddTarget,
  resolveServicesProjects,
  resolveShownErrors,
  resolveSuggestionKey,
  SERVICE_GLYPHS,
  selectServicePreview,
  serializeServiceEnv,
  togglePick,
  validateServiceDraft,
} from '@/lib/terminal/services.ts';
import { createProject, createShinsaState, NOW } from '../../support/state.ts';
import { createService, createTerminal, createTerminalsSnapshot } from '../../support/terminals.ts';

const API = createService({ id: 'api', env: { PORT: '4000' } });

const PLACES = [
  { path: '/shop', label: 'shop', kind: 'repository' as const, taskId: null },
  { path: '/notes', label: 'notes', kind: 'folder' as const, taskId: null },
];

const WORKTREE = { path: '/wt', label: 'wt', kind: 'worktree' as const, taskId: 't' };

const WEB = {
  name: 'web',
  cwd: '/shop/apps/web',
  command: 'bun run dev',
  source: 'package' as const,
  recommended: true,
};

const LATER = NOW + SERVICE_LIMITS.startingMs + 1;

function view(extra: Parameters<typeof createTerminal>[0] | null, now = LATER) {
  return resolveServiceView(API, extra ? createTerminal({ serviceId: 'api', ...extra }) : null, now);
}

describe('describeServiceState', () => {
  it('says how long a service has run, and how it failed', () => {
    expect(describeServiceState(view({ id: 't', startedAt: NOW }), NOW + 125_000)).toBe('Running for 2m');
    expect(describeServiceState(view({ id: 't', status: 'exited', exitCode: 3, endedAt: NOW }), LATER)).toBe(
      'Failed with code 3'
    );
    expect(
      describeServiceState(view({ id: 't', status: 'exited', exitCode: null, endedAt: NOW }), LATER)
    ).toBe('Failed');
    expect(describeServiceState(view(null), LATER)).toBe('Stopped');
    expect(describeServiceState(view({ id: 't', startedAt: NOW }, NOW), NOW)).toBe('Starting');
  });
});

describe('a service’s preview', () => {
  const service = createService({ id: 'web', previewUrl: 'http://localhost:{port}/tasks/SH-4' });
  const running = resolveServiceView(
    service,
    createTerminal({ id: 't-web', serviceId: 'web', port: 4123, startedAt: NOW - 60_000 }),
    NOW
  );
  const stopped = resolveServiceView(
    service,
    createTerminal({ id: 't-web', serviceId: 'web', port: 4123, status: 'stopped', endedAt: NOW }),
    NOW
  );

  it('has a URL only while the service runs', () => {
    expect(selectServicePreview(running)).toBe('http://localhost:4123/tasks/SH-4');
    expect(selectServicePreview(stopped)).toBeNull();
    expect(selectServicePreview(resolveServiceView(API, null, NOW))).toBeNull();
  });

  it('names the service, and the task when the run is a task’s', () => {
    expect(describeServicePreview(running)).toBe('Open web');
    expect(describeServicePreview(running, 'SH-4 Fix the cart')).toBe('Open web for SH-4 Fix the cart');
  });

  it('opens a running preview in a new window, and nothing for a stopped one', () => {
    const open = spyOn(window, 'open').mockImplementation(() => null);
    openServicePreview(stopped);
    expect(open).not.toHaveBeenCalled();
    openServicePreview(running);
    expect(open).toHaveBeenCalledWith('http://localhost:4123/tasks/SH-4', '_blank', 'noopener');
    open.mockRestore();
  });
});

describe('describeServicesTrigger', () => {
  it('leads with what failed, then what starts, then what runs, in their tones', () => {
    const running = view({ id: 'r', startedAt: NOW });
    const starting = view({ id: 's', startedAt: LATER });
    const failed = view({ id: 'f', status: 'exited', exitCode: 1, endedAt: NOW });
    expect(describeServicesTrigger([running, failed, starting])).toEqual({ label: '1 failed', tone: 'red' });
    expect(describeServicesTrigger([running, starting])).toEqual({ label: '1 starting', tone: 'blue' });
    expect(describeServicesTrigger([running, running])).toEqual({ label: '2 running', tone: 'neutral' });
    expect(describeServicesTrigger([view(null)])).toEqual({ label: 'Services', tone: 'neutral' });
  });
});

describe('describeTaskServicesFact', () => {
  it('names the services among the task’s facts, failed first, then starting, then running', () => {
    const running = view({ id: 'r', startedAt: NOW });
    const starting = view({ id: 's', startedAt: LATER });
    const failed = view({ id: 'f', status: 'exited', exitCode: 1, endedAt: NOW });
    expect(describeTaskServicesFact([running, failed, starting])).toEqual({
      label: '1 service failed',
      tone: 'red',
    });
    expect(describeTaskServicesFact([starting, starting])).toEqual({
      label: '2 services starting',
      tone: 'blue',
    });
    expect(describeTaskServicesFact([running])).toEqual({ label: '1 service running', tone: 'neutral' });
    expect(describeTaskServicesFact([view(null)])).toEqual({ label: 'Services', tone: 'neutral' });
  });
});

describe('a project’s services in the menu', () => {
  const running = view({ id: 'r', startedAt: NOW });
  const starting = view({ id: 's', startedAt: LATER });
  const failed = view({ id: 'f', status: 'exited', exitCode: 1, endedAt: NOW });
  const stopped = view(null);

  it('counts what failed, starts and runs, in their tones, else how many are stopped', () => {
    expect(describeServiceGroup([running, failed, starting, running])).toEqual([
      { label: '1 failed', tone: 'red' },
      { label: '1 starting', tone: 'blue' },
      { label: '2 running', tone: 'neutral' },
    ]);
    expect(describeServiceGroup([stopped, stopped])).toEqual([{ label: '2 stopped', tone: 'neutral' }]);
    expect(describeServiceGroup([])).toEqual([]);
  });

  it('offers Start all when two or more are not running, and starts the ones that are not', () => {
    expect(canStartAll([running, stopped])).toBe(false);
    expect(canStartAll([failed, stopped, running])).toBe(true);
    expect(listStoppedServices([failed, starting, stopped, running])).toEqual([failed, stopped]);
    expect(describeStartAll(createProject({ id: 'shop', name: 'Shop' }))).toBe('Start all services in Shop');
  });

  it('runs the service whose tab is in front, and none when a shell or no tab is', () => {
    const tab = createTerminal({ id: 'r', serviceId: 'api' });
    expect(resolveActiveService([stopped, running], tab)).toBe(running);
    expect(resolveActiveService([stopped, running], createTerminal({ id: 'shell' }))).toBeNull();
    expect(resolveActiveService([stopped, running], null)).toBeNull();
  });

  it('keeps each project’s fold apart', () => {
    expect(String(resolveServiceGroupId('shop'))).toBe('services:project:shop');
  });

  it('says what a service is when there are none, naming the project in view', () => {
    expect(describeServicesEmpty(null)).toEqual({
      title: 'No services yet',
      description: 'A service is a command you keep running for a project, like its dev server.',
    });
    expect(describeServicesEmpty(createProject({ id: 'shop', name: 'Shop' })).title).toBe(
      'No services in Shop yet'
    );
  });

  it('draws a stopped service as idle, never as a box', () => {
    expect(SERVICE_GLYPHS.stopped).toEqual({
      icon: 'IconCircleDashed',
      activeIcon: 'IconCircleDashedFilled',
      tone: 'neutral',
    });
    expect(SERVICE_GLYPHS.exited.icon).toBe('IconCircleDashed');
  });

  it('fills every state’s glyph on the tab in front', () => {
    for (const glyph of Object.values(SERVICE_GLYPHS))
      expect(String(glyph.activeIcon)).toBe(`${glyph.icon}Filled`);
  });
});

describe('which services the menu shows', () => {
  const state = createShinsaState({
    projects: [
      createProject({ id: 'shop', name: 'Shop', key: 'SH' }),
      createProject({ id: 'docs', name: 'Docs', key: 'DO' }),
    ],
  });

  it('shows the project you are in, else the focus project, else every project', () => {
    expect(resolveServicesProjects(state, 'docs', NOW).map((project) => project.id)).toEqual(['docs']);
    expect(resolveServicesProjects(state, null, NOW).map((project) => project.id)).toEqual(['docs', 'shop']);
    const focused = { ...state, focus: { projectId: 'shop', until: null } };
    expect(resolveServicesProjects(focused, null, NOW).map((project) => project.id)).toEqual(['shop']);
  });

  it('adds services to the project in view, else the one listed, else the first', () => {
    const snapshot = createTerminalsSnapshot([], [API]);
    const all = resolveServicesProjects(state, null, NOW);
    expect(resolveServicesAddTarget(all, listServiceGroups(snapshot, all, NOW))?.id).toBe('shop');
    const docs = resolveServicesProjects(state, 'docs', NOW);
    expect(resolveServicesAddTarget(docs, listServiceGroups(snapshot, docs, NOW))?.id).toBe('docs');
    expect(resolveServicesAddTarget(all, [])?.id).toBe('docs');
    expect(resolveServicesAddTarget([], [])).toBeNull();
  });

  it('groups services by project, and keeps a lone project even with none', () => {
    const snapshot = createTerminalsSnapshot([], [API]);
    const projects = resolveServicesProjects(state, null, NOW);
    expect(listServiceGroups(snapshot, projects, NOW).map((group) => group.project.id)).toEqual(['shop']);
    const docs = resolveServicesProjects(state, 'docs', NOW);
    expect(listServiceGroups(snapshot, docs, NOW)).toEqual([
      { project: expect.objectContaining({ id: 'docs' }), views: [], runs: {} },
    ]);
  });

  it('lists under each service the tasks running it or whose run failed, by handle and title', () => {
    const snapshot = createTerminalsSnapshot(
      [
        createTerminal({ id: 'main', serviceId: 'api', startedAt: NOW - 60_000 }),
        createTerminal({ id: 'a', serviceId: 'api', taskId: 'fix', startedAt: NOW - 60_000 }),
        createTerminal({
          id: 'b',
          serviceId: 'api',
          taskId: 'gone',
          status: 'exited',
          exitCode: 1,
          endedAt: NOW,
        }),
        createTerminal({
          id: 'c',
          serviceId: 'api',
          taskId: 'idle',
          status: 'exited',
          exitCode: 143,
          endedAt: NOW,
        }),
      ],
      [API]
    );
    const tasks = { fix: { handle: 'SH-4', title: 'Fix the cart' } } as unknown as Record<string, Task>;
    const [group] = listServiceGroups(snapshot, resolveServicesProjects(state, 'shop', NOW), LATER, tasks);
    expect(group?.runs?.api?.map((run) => [run.label, run.view.state])).toEqual([
      ['SH-4 Fix the cart', 'running'],
      ['A finished task', 'failed'],
    ]);
    expect(listProjectServiceRuns(snapshot, 'shop', LATER).map((each) => each.terminal?.id)).toEqual([
      'main',
      'a',
      'b',
      'c',
    ]);
    expect(describeTaskRunLabel({ handle: null, title: 'Untriaged' })).toBe('Untriaged');
  });
});

describe('a task’s services', () => {
  it('names the task in the popover’s header', () => {
    expect(describeTaskServices({ handle: 'SH-4' }).title).toBe('Services for SH-4');
    expect(describeTaskServices({ handle: null })).toEqual({
      title: 'Services for this task',
      description: 'Each runs in this task’s worktree, beside your own run.',
    });
  });
});

describe('the service form', () => {
  it('fills in from a service, or starts empty', () => {
    expect(createServiceDraft(API)).toEqual({
      name: 'api',
      path: API.cwd,
      command: 'bun run dev',
      env: 'PORT=4000',
      previewUrl: '',
      portVariable: '',
    });
    expect(
      createServiceDraft({ ...API, previewUrl: 'http://localhost:{port}', portVariable: 'APP_PORT' })
    ).toMatchObject({ previewUrl: 'http://localhost:{port}', portVariable: 'APP_PORT' });
    expect(createServiceDraft(null)).toEqual({
      name: '',
      path: '',
      command: '',
      env: '',
      previewUrl: '',
      portVariable: '',
    });
  });

  it('reads variables one a line, with export, quotes and comments, and refuses a line it cannot read', () => {
    expect(parseServiceEnv('PORT=4000\n\n# a note\nexport NAME="shop"\nURL=\'a=b\'')).toEqual({
      env: { PORT: '4000', NAME: 'shop', URL: 'a=b' },
    });
    expect(parseServiceEnv('not a line')).toEqual({
      error: 'Write each variable as NAME=value on a line of its own. “not a line” is not.',
    });
    expect(parseServiceEnv('1X=2')).toHaveProperty('error');
    const many = Array.from({ length: SERVICE_LIMITS.envKeys + 1 }, (_, index) => `K${index}=v`).join('\n');
    expect(parseServiceEnv(many)).toEqual({
      error: `A service takes ${SERVICE_LIMITS.envKeys} variables at most.`,
    });
    expect(serializeServiceEnv({ A: '1', B: '2' })).toBe('A=1\nB=2');
  });

  it('checks every field before it is sent', () => {
    const draft = {
      name: ' api ',
      path: ' /shop ',
      command: ' bun dev ',
      env: 'A=1',
      previewUrl: '',
      portVariable: '',
    };
    expect(validateServiceDraft(draft)).toEqual({
      ok: true,
      input: {
        name: 'api',
        cwd: '/shop',
        command: 'bun dev',
        env: { A: '1' },
        previewUrl: null,
        portVariable: 'PORT',
      },
    });
    expect(
      validateServiceDraft({
        ...draft,
        previewUrl: ' http://localhost:{port}/a ',
        portVariable: ' APP_PORT ',
      })
    ).toMatchObject({
      ok: true,
      input: { previewUrl: 'http://localhost:{port}/a', portVariable: 'APP_PORT' },
    });
    expect(
      validateServiceDraft({
        name: '',
        path: '',
        command: '',
        env: 'bad',
        previewUrl: 'localhost',
        portVariable: '1P',
      })
    ).toEqual({
      ok: false,
      errors: {
        name: 'Give the service a name.',
        path: 'Choose the folder it runs in.',
        command: 'Give the command that starts it.',
        env: 'Write each variable as NAME=value on a line of its own. “bad” is not.',
        previewUrl: 'Give an http or https address, with {port} where the run’s port goes.',
        portVariable: 'Use letters, digits and _, not starting with a digit.',
      },
    });
    expect(
      validateServiceDraft({ ...draft, previewUrl: `http://a.test/${'x'.repeat(SERVICE_LIMITS.previewUrl)}` })
    ).toMatchObject({ ok: false, errors: { previewUrl: expect.any(String) } });
    expect(
      validateServiceDraft({
        ...draft,
        name: 'x'.repeat(SERVICE_LIMITS.name + 1),
        path: '/a',
        command: 'b',
        env: '',
      })
    ).toMatchObject({ ok: false, errors: { name: `Keep the name to ${SERVICE_LIMITS.name} characters.` } });
  });

  it('words the forms for adding and editing, and the confirmations', () => {
    expect(resolveServiceForm('add', 'api')).toMatchObject({ title: 'Add services', done: 'Added api.' });
    expect(resolveServiceForm('custom', '')).toMatchObject({
      title: 'Add a service',
      description: 'Name the command that starts it and the folder it runs in.',
      action: 'Add service',
    });
    expect(resolveServiceForm('edit', 'api')).toMatchObject({ title: 'Edit api', action: 'Save' });
    expect(resolveServiceForm('edit', '').title).toBe('Edit the service');
    expect(describeServicesRemove([API])).toEqual({
      question: 'Remove api?',
      note: 'It stops and its terminal closes.',
      done: 'Removed api.',
    });
    const web = createService({ id: 'web' });
    const docs = createService({ id: 'docs' });
    expect(describeServicesRemove([API, web])).toEqual({
      question: 'Remove 2 services?',
      note: 'They stop and their terminals close.',
      done: 'Removed api and web.',
    });
    expect(describeServicesRemove([API, web, docs]).done).toBe('Removed 3 services.');
    expect(describeServiceClose(API)).toContain('“api” stops');
  });

  it('names a folder by the project place it is in', () => {
    expect(describeServiceFolder('/shop', PLACES)).toBe('shop');
    expect(describeServiceFolder('/shop/apps/api', PLACES)).toBe('shop/apps/api');
    expect(describeServiceFolder('/elsewhere', PLACES)).toBe('/elsewhere');
    expect(listServicePlaces([...PLACES, WORKTREE])).toEqual(PLACES);
  });

  it('offers the project’s folders, the ones a suggestion runs in, the home folder when it has none, and the saved one', () => {
    expect(listServiceFolders(PLACES, [WEB, { ...WEB, command: 'x' }], '/home', null)).toEqual([
      { value: '/shop', label: 'shop' },
      { value: '/notes', label: 'notes' },
      { value: '/shop/apps/web', label: 'shop/apps/web' },
    ]);
    expect(listServiceFolders([], [], '/home', '/home/x')).toEqual([
      { value: '/home', label: 'Home folder' },
      { value: '/home/x', label: '/home/x' },
    ]);
    expect(listServiceFolders([], [], null, null)).toEqual([]);
  });

  it('ticks the recommended suggestions, toggles one, and sends the ticked ones as services', () => {
    const all = { ...WEB, name: 'all', cwd: '/shop', recommended: false };
    const picked = listRecommendedPicks([WEB, all]);
    expect(picked).toEqual([resolveSuggestionKey(WEB)]);
    const both = togglePick(picked, resolveSuggestionKey(all));
    expect(both).toHaveLength(2);
    expect(togglePick(both, resolveSuggestionKey(WEB))).toEqual([resolveSuggestionKey(all)]);
    expect(listPickedInputs([WEB, all], picked)).toEqual([
      {
        name: 'web',
        cwd: '/shop/apps/web',
        command: 'bun run dev',
        env: {},
        previewUrl: null,
        portVariable: 'PORT',
      },
    ]);
  });

  it('words the add button, the toast and the empty list', () => {
    expect(describeAddServices(0)).toBe('Add services');
    expect(describeAddServices(1)).toBe('Add 1 service');
    expect(describeAddServices(3)).toBe('Add 3 services');
    expect(describeServicesAdded(['api'])).toBe('Added api.');
    expect(describeServicesAdded(['api', 'web'])).toBe('Added api and web.');
    expect(describeServicesAdded(['a', 'b', 'c'])).toBe('Added 3 services.');
    expect(describeNoSuggestions('Shop')).toBe(
      'No services found in Shop. Name the command that starts one and the folder it runs in.'
    );
  });

  it('selects every suggestion, or none once all are ticked', () => {
    const all = { ...WEB, name: 'all', cwd: '/shop', recommended: false };
    const keys = [resolveSuggestionKey(WEB), resolveSuggestionKey(all)];
    expect(listAllPicks([WEB, all], [keys[0] ?? ''])).toEqual({ label: 'Select all', picks: keys });
    expect(listAllPicks([WEB, all], keys)).toEqual({ label: 'Deselect all', picks: [] });
  });

  it('shows a field’s problem only once you have left it after typing, or tried to add', () => {
    const errors = { name: 'Give the service a name.', command: 'Give the command that starts it.' };
    expect(resolveShownErrors(errors, [], false)).toEqual({});
    expect(resolveShownErrors(errors, ['command'], false)).toEqual({ command: errors.command });
    expect(resolveShownErrors(errors, [], true)).toEqual(errors);
  });
});

describe('managing services', () => {
  it('counts the ones you ticked on the remove button', () => {
    expect(describeRemoveServices(0)).toBe('Remove services');
    expect(describeRemoveServices(1)).toBe('Remove 1 service');
    expect(describeRemoveServices(3)).toBe('Remove 3 services');
  });
});
