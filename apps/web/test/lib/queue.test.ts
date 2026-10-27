import { describe, expect, it } from 'bun:test';
import { resolveQueue } from '@shinsa/core';
import {
  describeNeedsCount,
  isQueueButtonShown,
  listQueueSections,
  type QueueSection,
  resolveSectionDefault,
  resolveSectionId,
} from '@/lib/queue.ts';
import {
  createGate,
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
    ],
    gates: [
      createGate({ id: 'g-review', taskId: 'review', type: 'review', openedAt: NOW - 3_000 }),
      createGate({ id: 'g-merge', taskId: 'merge', type: 'merge', openedAt: NOW - 2_000 }),
      createGate({ id: 'g-elsewhere', taskId: 'elsewhere', type: 'review' }),
    ],
    repos: [createRepo({ id: 'app', projectId: 'work' }), createRepo({ id: 'site', projectId: 'home' })],
    projects: [createProject({ id: 'work' }), createProject({ id: 'home' })],
    patch: { focus: { projectId: 'work', until: null } },
  });
}

function sectionsFor(briefed: ReadonlySet<string> | null) {
  const state = createWorld();
  return listQueueSections(state, resolveQueue(state, NOW), briefed);
}

function sectionOf(key: QueueSection['key']) {
  const section = sectionsFor(null).find((candidate) => candidate.key === key);
  if (!section) throw new Error(`No ${key} section`);
  return section;
}

describe('listQueueSections', () => {
  it('lists Needs you, In progress and Waiting on another task, all within the focus project', () => {
    const sections = sectionsFor(null);
    expect(sections.map((section) => [section.key, section.title])).toEqual([
      ['needs', 'Needs you'],
      ['working', 'In progress'],
      ['waiting', 'Waiting on another task'],
    ]);
    expect(sections.map((section) => section.items.map((item) => item.key))).toEqual([
      ['g-merge', 'g-review'],
      ['building'],
      ['parent', 'child'],
    ]);
  });

  it('borrows the roadmap title, icon and tone for the middle sections', () => {
    const [, working, waiting] = sectionsFor(null);
    expect(working).toMatchObject({ icon: 'IconRobot', tone: 'blue', startsCollapsed: false });
    expect(waiting).toMatchObject({ icon: 'IconHourglass', tone: 'neutral', startsCollapsed: true });
  });

  it('dates each row from when it started waiting on you, its step started, or it was asked for', () => {
    const [needs, working, waiting] = sectionsFor(null);
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
    const [needs, working, waiting] = listQueueSections(state, resolveQueue(state, NOW), null);
    expect(needs?.empty).toBe('Nothing is waiting on you.');
    expect(working?.empty).toBe('No agent is working right now.');
    expect(waiting?.empty).toBeNull();
  });

  it('becomes Also needs you under the guide, without the tasks the guide names and with no empty line', () => {
    const [needs] = sectionsFor(new Set(['merge']));
    expect(needs?.title).toBe('Also needs you');
    expect(needs?.items.map((item) => item.key)).toEqual(['g-review']);
    expect(needs?.empty).toBeNull();
    const [allBriefed] = sectionsFor(new Set(['merge', 'review']));
    expect(allBriefed?.items).toEqual([]);
    expect(allBriefed?.empty).toBeNull();
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
