import { describe, expect, it } from 'bun:test';
import { resolveServiceView, SERVICE_LIMITS } from '@shinsa/core';
import {
  createServiceDraft,
  describeServiceClose,
  describeServiceRemove,
  describeServiceState,
  describeServicesTrigger,
  describeSuggestionSource,
  listServiceGroups,
  parseServiceEnv,
  resolveServiceDialog,
  resolveServicesProjects,
  serializeServiceEnv,
  validateServiceDraft,
} from '@/lib/terminal/services.ts';
import { createProject, createShinsaState, NOW } from '../../support/state.ts';
import { createService, createTerminal, createTerminalsSnapshot } from '../../support/terminals.ts';

const API = createService({ id: 'api', env: { PORT: '4000' } });

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
  it('fills in from a service or a suggestion, or starts empty in a folder', () => {
    expect(createServiceDraft(API, null)).toEqual({
      name: 'api',
      path: API.cwd,
      command: 'bun run dev',
      env: 'PORT=4000',
    });
    expect(
      createServiceDraft({ name: 'web', cwd: '/web', command: 'vite', source: 'package' }, null)
    ).toEqual({ name: 'web', path: '/web', command: 'vite', env: '' });
    expect(createServiceDraft(null, '/shop')).toEqual({ name: '', path: '/shop', command: '', env: '' });
    expect(createServiceDraft(null, null).path).toBe('');
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
    expect(resolveServiceDialog('add', 'api')).toMatchObject({ title: 'Add a service', done: 'Added api.' });
    expect(resolveServiceDialog('edit', 'api')).toMatchObject({ title: 'Edit api', action: 'Save' });
    expect(resolveServiceDialog('edit', '').title).toBe('Edit the service');
    expect(describeServiceRemove(API)).toContain('“api”');
    expect(describeServiceClose(API)).toContain('“api” stops');
  });

  it('says where a suggestion runs, relative to the project', () => {
    const suggestion = {
      name: 'api',
      cwd: '/shop/apps/api',
      command: 'bun run dev',
      source: 'package',
    } as const;
    expect(describeSuggestionSource(suggestion, '/shop')).toBe('bun run dev in apps/api');
    expect(describeSuggestionSource({ ...suggestion, cwd: '/shop' }, '/shop')).toBe('bun run dev');
    expect(describeSuggestionSource(suggestion, null)).toBe('bun run dev');
  });
});
