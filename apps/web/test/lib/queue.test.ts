import { describe, expect, it } from 'bun:test';
import { resolveQueue } from '@shinsa/core';
import {
  countGroupTasks,
  describeNeedsCount,
  isQueueButtonShown,
  listQueueSections,
  type QueueEntry,
  type QueueGroup,
  type QueueSection,
  describeGroupSummary,
  resolveSectionDefault,
  resolveSectionId,
} from '@/lib/queue.ts';
import {
  createGate,
  createInitiative,
  createProject,
  createRepo,
  createShinsaState,
  createTask,
  NOW,
} from '../support/state.ts';

function createWorld() {
  return createShinsaState({
    tasks: [
      createTask({ id: 'review', repoId: 'app', createdAt: NOW - 90_000 }),
      createTask({ id: 'merge', repoId: 'app', createdAt: NOW - 80_000 }),
      createTask({ id: 'elsewhere', repoId: 'site' }),
      createTask({ id: 'building', repoId: 'app', stageChangedAt: NOW - 5_000 }),
      createTask({
        id: 'child',
        repoId: 'app',
        stage: 'waiting_on_tasks',
        waitsOn: ['parent'],
        createdAt: NOW - 70_000,
      }),
      createTask({
        id: 'parent',
        repoId: 'app',
        stage: 'waiting_on_tasks',
        waitsOn: ['building'],
        createdAt: NOW - 1_000,
      }),
      createTask({ id: 'aside', repoId: 'app', stage: 'awaiting_review', snoozed: { at: NOW - 4_000 } }),
    ],
    gates: [
      createGate({ id: 'g-review', taskId: 'review', type: 'review', openedAt: NOW - 3_000 }),
      createGate({ id: 'g-merge', taskId: 'merge', type: 'merge', openedAt: NOW - 2_000 }),
      createGate({ id: 'g-elsewhere', taskId: 'elsewhere', type: 'review' }),
      createGate({ id: 'g-aside', taskId: 'aside', type: 'review' }),
    ],
    repos: [createRepo({ id: 'app', projectId: 'work' }), createRepo({ id: 'site', projectId: 'home' })],
    projects: [createProject({ id: 'work' }), createProject({ id: 'home' })],
    patch: { focus: { projectIds: ['work'], except: false, teamId: null, until: null } },
  });
}

function sectionsFor() {
  const state = createWorld();
  return listQueueSections(state, resolveQueue(state, NOW));
}

function sectionOf(key: QueueSection['key']) {
  const section = sectionsFor().find((candidate) => candidate.key === key);
  if (!section) throw new Error(`No ${key} section`);
  return section;
}

describe('listQueueSections', () => {
  it('lists Needs you, In progress, Waiting on another task and Snoozed, all within the focus project', () => {
    const sections = sectionsFor();
    expect(sections.map((section) => [section.key, section.title])).toEqual([
      ['needs', 'Needs you'],
      ['working', 'In progress'],
      ['waiting', 'Waiting on another task'],
      ['snoozed', 'Snoozed'],
    ]);
    expect(sections.map((section) => section.items.map((item) => item.key))).toEqual([
      ['g-merge', 'g-review'],
      ['building'],
      ['parent', 'child'],
      ['aside'],
    ]);
  });

  it('borrows the task group title, icon and tone for the middle sections', () => {
    const [, working, waiting] = sectionsFor();
    expect(working).toMatchObject({ icon: 'IconRobot', tone: 'blue', startsCollapsed: false });
    expect(waiting).toMatchObject({ icon: 'IconHourglass', tone: 'neutral', startsCollapsed: true });
  });

  it('keeps Snoozed folded on Home and in the queue, dated from when you snoozed it', () => {
    const snoozed = sectionOf('snoozed');
    expect(snoozed).toMatchObject({
      icon: 'IconClockSnooze',
      startsCollapsed: true,
      opensOnHome: false,
      empty: null,
    });
    expect(snoozed.items[0]).toMatchObject({ kind: 'idle', since: NOW - 4_000, sinceLabel: 'Snoozed' });
    expect(sectionOf('waiting').opensOnHome).toBe(true);
  });

  it('dates each row from when it started waiting on you, its step started, or it was asked for', () => {
    const [needs, working, waiting] = sectionsFor();
    expect(needs?.items[0]).toMatchObject({ kind: 'gate', since: NOW - 2_000, sinceLabel: 'Waiting on you' });
    expect(working?.items[0]).toMatchObject({
      kind: 'working',
      since: NOW - 5_000,
      sinceLabel: 'Step started',
    });
    expect(waiting?.items[0]).toMatchObject({ kind: 'idle', since: NOW - 1_000, sinceLabel: 'Asked for' });
  });

  it('says so when nothing waits on you and no agent is working', () => {
    const state = createShinsaState({});
    const [needs, working, waiting] = listQueueSections(state, resolveQueue(state, NOW));
    expect(needs?.empty).toBe('Nothing is waiting on you.');
    expect(working?.empty).toBe('No agent is working right now.');
    expect(waiting?.empty).toBeNull();
  });
});

describe('section open state', () => {
  it('stores each section under its own key', () => {
    expect(String(resolveSectionId(sectionOf('needs')))).toBe('queue:section:needs');
    expect(String(resolveSectionId(sectionOf('waiting')))).toBe('queue:section:waiting');
  });

  it('opens fixed sections, and collapsed ones only when they hold the task on screen', () => {
    expect(resolveSectionDefault(sectionOf('needs'), null)).toBe(true);
    expect(resolveSectionDefault(sectionOf('working'), null)).toBe(true);
    expect(resolveSectionDefault(sectionOf('waiting'), null)).toBe(false);
    expect(resolveSectionDefault(sectionOf('waiting'), 'child')).toBe(true);
  });
});

describe('describeNeedsCount', () => {
  it('agrees the verb with the count', () => {
    expect(describeNeedsCount(0)).toBe('Nothing needs you');
    expect(describeNeedsCount(1)).toBe('1 needs you');
    expect(describeNeedsCount(3)).toBe('3 need you');
  });
});

describe('isQueueButtonShown', () => {
  it('shows the queue button everywhere but Home, the task list and setup', () => {
    expect(isQueueButtonShown({ name: 'task', reference: 'SW-1' })).toBe(true);
    expect(isQueueButtonShown({ name: 'settings' })).toBe(true);
    expect(isQueueButtonShown({ name: 'terminal' })).toBe(true);
    expect(isQueueButtonShown({ name: 'ui' })).toBe(true);
    expect(isQueueButtonShown({ name: 'home' })).toBe(false);
    expect(isQueueButtonShown({ name: 'tasks' })).toBe(false);
    expect(isQueueButtonShown({ name: 'onboarding' })).toBe(false);
  });
});

describe('initiative members on Home', () => {
  function createInitiativeWorld(lead: Partial<Parameters<typeof createTask>[0]>) {
    return createShinsaState({
      initiatives: [createInitiative({ id: 'split', name: 'Chat split', leadTaskId: 'lead' })],
      tasks: [
        createTask({
          id: 'lead',
          title: 'Chat split',
          pipeline: ['lead'],
          stage: 'leading',
          initiativeId: 'split',
          ...lead,
        }),
        createTask({ id: 'build', stage: 'building', initiativeId: 'split' }),
        createTask({ id: 'later', stage: 'waiting_on_tasks', waitsOn: ['build'], initiativeId: 'split' }),
      ],
    });
  }

  function listKeys(sections: QueueSection[], key: QueueSection['key']) {
    return sections.find((section) => section.key === key)?.items.map((item) => item.key);
  }

  it('lists the members where any task sits and leaves the lead out', () => {
    for (const lead of [{}, { snoozed: { at: NOW } }, { backlog: { at: NOW } }]) {
      const state = createInitiativeWorld(lead);
      const sections = listQueueSections(state, resolveQueue(state, NOW));
      expect(listKeys(sections, 'working')).toEqual(['build']);
      expect(listKeys(sections, 'waiting')).toEqual(['later']);
      expect(listKeys(sections, 'snoozed')).toEqual([]);
    }
  });
});

describe('groups of a bundle or an initiative', () => {
  function createGroupWorld() {
    return createShinsaState({
      initiatives: [
        createInitiative({
          id: 'split',
          name: 'Chat split',
          leadTaskId: 'lead',
          phases: [{ id: 'p1', name: 'Dock host' }],
        }),
      ],
      tasks: [
        createTask({
          id: 'lead',
          title: 'Chat split',
          pipeline: ['lead'],
          stage: 'leading',
          initiativeId: 'split',
        }),
        createTask({
          id: 'dock',
          stage: 'building',
          initiativeId: 'split',
          initiativePhaseId: 'p1',
          createdAt: NOW - 60_000,
        }),
        createTask({
          id: 'panel',
          stage: 'planning',
          initiativeId: 'split',
          initiativePhaseId: 'p1',
          createdAt: NOW - 40_000,
        }),
        createTask({ id: 'shipped', stage: 'merged', initiativeId: 'split', initiativePhaseId: 'p1' }),
        createTask({ id: 'dropped', stage: 'cancelled', initiativeId: 'split' }),
        createTask({ id: 'solo', stage: 'building', createdAt: NOW - 50_000 }),
        createTask({ id: 'root', title: 'Schema', stage: 'shipping', bundleReady: { commit: 'abc' } }),
        createTask({
          id: 'api',
          title: 'API',
          stage: 'waiting_on_tasks',
          stacksOn: ['root'],
          createdAt: NOW - 40_000,
        }),
        createTask({
          id: 'screen',
          title: 'Screen',
          stage: 'waiting_on_tasks',
          stacksOn: ['api'],
          createdAt: NOW - 30_000,
        }),
        createTask({
          id: 'lone',
          title: 'Lone',
          stage: 'waiting_on_tasks',
          stacksOn: ['other'],
          createdAt: NOW - 20_000,
        }),
        createTask({ id: 'other', title: 'Other', stage: 'awaiting_review' }),
        createTask({
          id: 'both',
          title: 'Both',
          stage: 'waiting_on_tasks',
          stacksOn: ['root'],
          initiativeId: 'split',
        }),
      ],
      gates: [createGate({ id: 'g-other', taskId: 'other', type: 'review' })],
    });
  }

  function sectionsOf() {
    const state = createGroupWorld();
    return listQueueSections(state, resolveQueue(state, NOW));
  }

  function sectionNamed(key: QueueSection['key']) {
    const section = sectionsOf().find((candidate) => candidate.key === key);
    if (!section) throw new Error(`No ${key} section`);
    return section;
  }

  function describeEntry(entry: QueueEntry) {
    if (entry.kind === 'item') return entry.item.key;
    const { group } = entry;
    return [group.kind, group.title, group.root?.key ?? null, group.members.map((item) => item.key)];
  }

  function groupIn(key: QueueSection['key']): QueueGroup {
    const entry = sectionNamed(key).entries.find((candidate) => candidate.kind === 'group');
    if (entry?.kind !== 'group') throw new Error(`No group in ${key}`);
    return entry.group;
  }

  it('puts two tasks of one initiative under its name, where the first of them sat', () => {
    const working = sectionNamed('working');
    expect(working.items.map((item) => item.key)).toEqual(['dock', 'solo', 'panel']);
    expect(working.entries.map(describeEntry)).toEqual([
      ['initiative', 'Chat split', null, ['dock', 'panel']],
      'solo',
    ]);
  });

  it('opens the lead task from an initiative, with how far its tasks have shipped', () => {
    const group = groupIn('working');
    expect(group.opens?.id).toBe('lead');
    expect(group.progress).toBe('1 of 4 shipped · 1 dropped');
    expect(countGroupTasks(group)).toBe(2);
  });

  it('puts a bundle under the first of its tasks in bundle order, with how many are ready', () => {
    const waiting = sectionNamed('waiting');
    const bundle = waiting.entries
      .map(describeEntry)
      .find((entry) => Array.isArray(entry) && entry[0] === 'bundle');
    expect(bundle).toEqual(['bundle', 'Schema', 'root', ['api', 'screen']]);
    const group = waiting.entries.flatMap((entry) =>
      entry.kind === 'group' && entry.group.kind === 'bundle' ? [entry.group] : []
    )[0];
    expect(group?.opens?.id).toBe('screen');
    expect(group?.progress).toBe('1 of 4 ready');
    expect(group && countGroupTasks(group)).toBe(3);
  });

  it('leaves a single task of a bundle or an initiative as a plain row', () => {
    const waiting = sectionNamed('waiting').entries.map(describeEntry);
    expect(waiting).toContain('lone');
    expect(waiting).toContain('both');
  });

  it('never groups what needs you', () => {
    expect(sectionNamed('needs').entries).toEqual(
      sectionNamed('needs').items.map((item) => ({ kind: 'item', item }))
    );
  });

  it('says how many of a group’s tasks are here and how far it has come', () => {
    const initiative = groupIn('working');
    const bundle = groupIn('waiting');
    expect(describeGroupSummary(initiative)).toBe('2 tasks here · 1 of 4 shipped · 1 dropped');
    expect(describeGroupSummary(bundle)).toBe('3 tasks here · 1 of 4 ready');
  });

  it('opens the bundle’s task still being worked on, the latest one first', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'base', title: 'Base', stage: 'shipping', bundleReady: { commit: 'abc' } }),
        createTask({
          id: 'mid',
          title: 'Mid',
          stage: 'building',
          stacksOn: ['base'],
          createdAt: NOW - 40_000,
        }),
        createTask({
          id: 'top',
          title: 'Top',
          stage: 'waiting_on_tasks',
          stacksOn: ['mid'],
          createdAt: NOW - 30_000,
        }),
        createTask({
          id: 'tip',
          title: 'Tip',
          stage: 'waiting_on_tasks',
          stacksOn: ['top'],
          createdAt: NOW - 20_000,
        }),
      ],
    });
    const waiting = listQueueSections(state, resolveQueue(state, NOW)).find(
      (section) => section.key === 'waiting'
    );
    const entry = waiting?.entries.find((candidate) => candidate.kind === 'group');
    expect(entry?.kind === 'group' && entry.group.opens?.id).toBe('mid');
  });
});
