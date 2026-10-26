import { describe, expect, it } from 'bun:test';
import { resolveServiceView, SERVICE_LIMITS } from '@shinsa/core';
import {
  createServiceDraft,
  describeAddServices,
  describeNoSuggestions,
  describeServiceClose,
  describeServiceFolder,
  describeServiceRemove,
  describeServiceState,
  describeServicesAdded,
  describeServicesTrigger,
  listPickedInputs,
  listRecommendedPicks,
  listServiceFolders,
  listServiceGroups,
  listServicePlaces,
  parseServiceEnv,
  resolveServiceDialog,
  resolveServicesAddTarget,
  resolveServicesProjects,
  resolveSuggestionKey,
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
      { project: expect.objectContaining({ id: 'docs' }), views: [] },
    ]);
  });
});

describe('the service form', () => {
  it('fills in from a service, or starts empty', () => {
    expect(createServiceDraft(API)).toEqual({
      name: 'api',
      path: API.cwd,
      command: 'bun run dev',
      env: 'PORT=4000',
    });
    expect(createServiceDraft(null)).toEqual({ name: '', path: '', command: '', env: '' });
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
    expect(
      validateServiceDraft({ name: ' api ', path: ' /shop ', command: ' bun dev ', env: 'A=1' })
    ).toEqual({
      ok: true,
      input: { name: 'api', cwd: '/shop', command: 'bun dev', env: { A: '1' } },
    });
    expect(validateServiceDraft({ name: '', path: '', command: '', env: 'bad' })).toEqual({
      ok: false,
      errors: {
        name: 'Give the service a name.',
        path: 'Choose the folder it runs in.',
        command: 'Give the command that starts it.',
        env: 'Write each variable as NAME=value on a line of its own. “bad” is not.',
      },
    });
    expect(
      validateServiceDraft({ name: 'x'.repeat(SERVICE_LIMITS.name + 1), path: '/a', command: 'b', env: '' })
    ).toMatchObject({ ok: false, errors: { name: `Keep the name to ${SERVICE_LIMITS.name} characters.` } });
  });

  it('words the dialog for adding and editing, and the confirmations', () => {
    expect(resolveServiceDialog('add', 'api')).toMatchObject({ title: 'Add services', done: 'Added api.' });
    expect(resolveServiceDialog('edit', 'api')).toMatchObject({ title: 'Edit api', action: 'Save' });
    expect(resolveServiceDialog('edit', '').title).toBe('Edit the service');
    expect(describeServiceRemove(API)).toContain('“api”');
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
      { name: 'web', cwd: '/shop/apps/web', command: 'bun run dev', env: {} },
    ]);
  });

  it('words the add button, the toast and the empty list', () => {
    expect(describeAddServices(0)).toBe('Add services');
    expect(describeAddServices(1)).toBe('Add 1 service');
    expect(describeAddServices(3)).toBe('Add 3 services');
    expect(describeServicesAdded(['api'])).toBe('Added api.');
    expect(describeServicesAdded(['api', 'web'])).toBe('Added api and web.');
    expect(describeServicesAdded(['a', 'b', 'c'])).toBe('Added 3 services.');
    expect(describeNoSuggestions('Shop')).toBe('No services found in Shop.');
  });
});
