import { describe, expect, test } from 'bun:test';
import { resolveQueue } from '../../src/index.ts';
import { createHarness, createTask, registerRepo } from '../harness.ts';

describe('repositories', () => {
  test('registering repositories files them into areas by name', () => {
    const harness = createHarness();
    registerRepo(harness);
    registerRepo(harness, 'paywall-editor', 'superwall');
    const areas = Object.values(harness.state.areas);
    expect(areas.map((area) => area.name)).toEqual(['Superwall']);
    expect(Object.values(harness.state.repos).every((repo) => repo.areaId === areas[0]?.id)).toBe(true);
  });

  test('a repository is registered once per path, and without an area name it has no area', () => {
    const harness = createHarness();
    registerRepo(harness, 'shinsa', null);
    const events = harness.state.seq;
    registerRepo(harness, 'shinsa', 'Personal');
    expect(harness.state.seq).toBe(events);
    expect(Object.values(harness.state.repos)).toMatchObject([{ name: 'shinsa', areaId: null }]);
  });

  test('a new area gets the next color', () => {
    const harness = createHarness();
    registerRepo(harness, 'a', 'One');
    registerRepo(harness, 'b', 'Two');
    expect(Object.values(harness.state.areas).map((area) => area.color)).toEqual(['blue', 'purple']);
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

  test('a repository update must name a repository and an area that exist', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    expect(() => harness.send({ type: 'repo.update', repoId: 'nope', patch: {} })).toThrow(
      'No repository nope'
    );
    expect(() => harness.send({ type: 'repo.update', repoId, patch: { areaId: 'nope' } })).toThrow(
      'No area nope'
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

describe('areas', () => {
  test('writing an area trims its name and skips a write that changes nothing', () => {
    const harness = createHarness();
    harness.send({ type: 'area.write', area: { id: 'work', name: '  Work ', color: 'blue' } });
    expect(harness.state.areas.work).toEqual({ id: 'work', name: 'Work', color: 'blue' });
    const events = harness.state.seq;
    harness.send({ type: 'area.write', area: { id: 'work', name: 'Work', color: 'blue' } });
    expect(harness.state.seq).toBe(events);
    harness.send({ type: 'area.write', area: { id: 'work', name: 'Work', color: 'green' } });
    expect(harness.state.areas.work?.color).toBe('green');
  });

  test('a new area gets an id, and an area needs a name', () => {
    const harness = createHarness();
    harness.send({ type: 'area.write', area: { name: 'Side', color: 'pink' } });
    expect(Object.values(harness.state.areas)).toMatchObject([{ name: 'Side', color: 'pink' }]);
    expect(() => harness.send({ type: 'area.write', area: { name: '  ', color: 'pink' } })).toThrow(
      'Name the area.'
    );
  });

  test('removing the focused area clears its repositories and the focus, so nothing hides', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness, 'paywall-next', 'Superwall');
    const areaId = harness.state.repos[repoId]?.areaId ?? '';
    const other = registerRepo(harness, 'shinsa', 'Personal');
    harness.send({ type: 'focus.change', areaId, until: null });
    createTask(harness, { repoId });
    harness.send({ type: 'area.remove', areaId });
    expect(harness.state.areas[areaId]).toBeUndefined();
    expect(harness.state.repos[repoId]?.areaId).toBeNull();
    expect(harness.state.repos[other]?.areaId).not.toBeNull();
    expect(harness.state.focus).toEqual({ areaId: null, until: null });
    expect(harness.lastEffect('briefing.request').areaId).toBeNull();
    expect(resolveQueue(harness.state, 0).working).toHaveLength(1);
  });

  test('removing an area that is not focused leaves the focus alone, and a missing area is a no-op', () => {
    const harness = createHarness();
    registerRepo(harness, 'a', 'One');
    const [one] = Object.keys(harness.state.areas);
    harness.send({ type: 'area.write', area: { id: 'two', name: 'Two', color: 'blue' } });
    harness.send({ type: 'focus.change', areaId: 'two', until: null });
    harness.send({ type: 'area.remove', areaId: one ?? '' });
    expect(harness.state.focus.areaId).toBe('two');
    const events = harness.state.seq;
    harness.send({ type: 'area.remove', areaId: 'gone' });
    expect(harness.state.seq).toBe(events);
  });
});

describe('focus', () => {
  test('focusing asks for a new guide, and focusing the same way twice does nothing', () => {
    const harness = createHarness();
    harness.send({ type: 'area.write', area: { id: 'work', name: 'Work', color: 'blue' } });
    harness.send({ type: 'focus.change', areaId: 'work', until: 9_000 });
    expect(harness.state.focus).toEqual({ areaId: 'work', until: 9_000 });
    expect(harness.lastEffect('briefing.request').areaId).toBe('work');
    const events = harness.state.seq;
    harness.send({ type: 'focus.change', areaId: 'work', until: 9_000 });
    expect(harness.state.seq).toBe(events);
  });

  test('focus must name an area that exists', () => {
    const harness = createHarness();
    expect(() => harness.send({ type: 'focus.change', areaId: 'nope', until: null })).toThrow('No area nope');
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

  test('an unknown stored setting is kept but has no effect', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { maxConcurrentRuns: 1 } as never });
    const first = createTask(harness);
    const second = createTask(harness);
    expect(harness.activeRun(first).status).toBe('running');
    expect(harness.activeRun(second).status).toBe('running');
  });
});

describe('the guide', () => {
  test('a written guide is stored per area, with its structure when there is one', () => {
    const harness = createHarness();
    const briefing = { now: null, next: [], running: 'No agent is working right now.', note: null };
    harness.send({ type: 'briefing.write', areaId: null, text: 'Nothing needs you.', briefing });
    harness.send({ type: 'briefing.write', areaId: 'work', text: 'Plain.' });
    expect(harness.state.briefings['*']?.briefing).toEqual(briefing);
    expect(harness.state.briefings.work).toMatchObject({ text: 'Plain.', briefing: null });
  });
});
