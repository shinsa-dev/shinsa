import { describe, expect, it } from 'bun:test';
import { type Activity, resolveQueue, type Task } from '@shinsa/core';
import {
  dropPullRequestNumbers,
  listRecentConversations,
  listRecentlyFinished,
  resolveGreeting,
  resolveHomeSectionId,
  resolveHomeSections,
  resolvePreview,
  resolveRunningVerb,
} from '@/lib/home.ts';
import { listQueueSections } from '@/lib/queue.ts';
import { createGate, createRepo, createShinsaState, createTask, NOW } from '../support/state.ts';

const DAY = 24 * 60 * 60_000;

const NONE = new Set<string>();

function entry(overrides: Partial<Activity>): Activity {
  return {
    at: NOW,
    actor: 'agent',
    kind: 'message',
    text: 'Done',
    detail: null,
    evidenceId: null,
    runId: 'run',
    ...overrides,
  };
}

describe('listRecentConversations', () => {
  it('takes the latest agent message of each task, newest first, five at most', () => {
    const tasks = Array.from({ length: 7 }, (_, index) =>
      createTask({
        id: `t${index}`,
        activity: [entry({ at: NOW - index * 1000, text: `Latest ${index}` }), entry({ at: NOW - 99_000 })],
      })
    );
    const recent = listRecentConversations(createShinsaState({ tasks }), NOW, NONE);
    expect(recent.map(({ task }) => task.id)).toEqual(['t0', 't1', 't2', 't3', 't4']);
    expect(recent[1]?.entry.text).toBe('Latest 1');
  });

  it('keeps the first of two messages at the same moment', () => {
    const task = createTask({
      id: 't',
      activity: [entry({ text: 'First' }), entry({ text: 'Second' })],
    });
    expect(listRecentConversations(createShinsaState({ tasks: [task] }), NOW, NONE)[0]?.entry.text).toBe(
      'First'
    );
  });

  it('leaves out your messages, Shinsa notes and agent entries without a run', () => {
    const task = createTask({
      id: 't',
      activity: [
        entry({ actor: 'you' }),
        entry({ actor: 'shinsa' }),
        entry({ runId: null }),
        entry({ runId: undefined }),
      ],
    });
    expect(listRecentConversations(createShinsaState({ tasks: [task] }), NOW, NONE)).toEqual([]);
  });
});

describe('listRecentlyFinished', () => {
  it('lists merged and done tasks from the last 24 hours, newest first', () => {
    const tasks = [
      createTask({ id: 'merged', stage: 'merged', stageChangedAt: NOW - DAY / 2 }),
      createTask({ id: 'done', stage: 'done', stageChangedAt: NOW - 1000 }),
      createTask({ id: 'edge', stage: 'done', stageChangedAt: NOW - DAY }),
      createTask({ id: 'old', stage: 'merged', stageChangedAt: NOW - DAY - 1 }),
      createTask({ id: 'last-week', stage: 'done', stageChangedAt: NOW - 3 * DAY }),
      createTask({ id: 'cancelled', stage: 'cancelled', stageChangedAt: NOW }),
      createTask({ id: 'open', stageChangedAt: NOW }),
    ];
    expect(listRecentlyFinished(createShinsaState({ tasks }), NOW, NONE).map((task) => task.id)).toEqual([
      'done',
      'merged',
      'edge',
    ]);
  });

  it('shows five at most', () => {
    const tasks = Array.from({ length: 6 }, (_, index) =>
      createTask({ id: `t${index}`, stage: 'done', stageChangedAt: NOW - index })
    );
    expect(listRecentlyFinished(createShinsaState({ tasks }), NOW, NONE)).toHaveLength(5);
  });
});

describe('Home within the focus project', () => {
  it('lists only the focus project’s finished tasks and conversations', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'work', repoId: 'api', stage: 'done', stageChangedAt: NOW, activity: [entry({})] }),
        createTask({
          id: 'home',
          repoId: 'garden',
          stage: 'done',
          stageChangedAt: NOW,
          activity: [entry({})],
        }),
      ],
      repos: [createRepo({ id: 'api', projectId: 'work' }), createRepo({ id: 'garden', projectId: 'home' })],
      patch: { focus: { projectId: 'work', until: null } },
    });
    expect(listRecentlyFinished(state, NOW, NONE).map((task) => task.id)).toEqual(['work']);
    expect(listRecentConversations(state, NOW, NONE).map(({ task }) => task.id)).toEqual(['work']);
    const everything = { ...state, focus: { projectId: null, until: null } };
    expect(listRecentlyFinished(everything, NOW, NONE)).toHaveLength(2);
    expect(listRecentConversations(everything, NOW, NONE)).toHaveLength(2);
  });
});

describe('resolveHomeSectionId', () => {
  it('keeps Home sections apart from the compact queue', () => {
    expect(String(resolveHomeSectionId('needs'))).toBe('home:section:needs');
    expect(String(resolveHomeSectionId('finished'))).toBe('home:section:finished');
  });
});

describe('resolveHomeSections', () => {
  it('puts the sections that start open first and the ones that start collapsed last', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'review', stage: 'reviewing' }),
        createTask({ id: 'build', stage: 'building' }),
        createTask({ id: 'later', stage: 'waiting_on_tasks', waitsOn: ['build'] }),
      ],
      gates: [createGate({ id: 'g-review', taskId: 'review', type: 'review' })],
    });
    const { first, last } = resolveHomeSections(
      state,
      listQueueSections(state, resolveQueue(state, NOW)),
      NOW
    );
    expect(first.map((section) => section.key)).toEqual(['needs', 'working']);
    expect(last.map((section) => section.key)).toEqual(['waiting']);
  });

  it('shows each task in one section: the queue first, then Recently finished, then Recent conversations', () => {
    const talked = [entry({})];
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'review', stage: 'reviewing', activity: talked }),
        createTask({ id: 'build', stage: 'building', activity: talked }),
        createTask({ id: 'later', stage: 'waiting_on_tasks', waitsOn: ['build'], activity: talked }),
        createTask({ id: 'operate', stage: 'merged', stageChangedAt: NOW, activity: talked }),
        createTask({ id: 'finished', stage: 'done', stageChangedAt: NOW, activity: talked }),
        createTask({ id: 'old', stage: 'done', stageChangedAt: NOW - 30 * DAY, activity: talked }),
      ],
      gates: [
        createGate({ id: 'g-review', taskId: 'review', type: 'review' }),
        createGate({ id: 'g-operate', taskId: 'operate', type: 'review' }),
      ],
    });
    const home = resolveHomeSections(state, listQueueSections(state, resolveQueue(state, NOW)), NOW);
    const ids = [
      ...home.first.flatMap((section) => section.items.map((item) => item.task.id)),
      ...home.finished.map((task) => task.id),
      ...home.conversations.map(({ task }) => task.id),
      ...home.last.flatMap((section) => section.items.map((item) => item.task.id)),
    ];
    expect(home.finished.map((task) => task.id)).toEqual(['finished']);
    expect(home.conversations.map(({ task }) => task.id)).toEqual(['old']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fills Recent conversations with five tasks no other section shows', () => {
    const tasks = Array.from({ length: 7 }, (_, index) =>
      createTask({
        id: `t${index}`,
        stage: index < 2 ? 'done' : 'cancelled',
        stageChangedAt: NOW,
        activity: [entry({ at: NOW - index * 1000 })],
      })
    );
    const state = createShinsaState({ tasks });
    const home = resolveHomeSections(state, listQueueSections(state, resolveQueue(state, NOW)), NOW);
    expect(home.finished.map((task) => task.id)).toEqual(['t0', 't1']);
    expect(home.conversations.map(({ task }) => task.id)).toEqual(['t2', 't3', 't4', 't5', 't6']);
  });
});

describe('resolveGreeting', () => {
  function at(hour: number) {
    return new Date(2026, 9, 22, hour, 30).getTime();
  }

  it('greets by the local hour', () => {
    expect(resolveGreeting(at(4))).toBe('Good evening.');
    expect(resolveGreeting(at(5))).toBe('Good morning.');
    expect(resolveGreeting(at(11))).toBe('Good morning.');
    expect(resolveGreeting(at(12))).toBe('Good afternoon.');
    expect(resolveGreeting(at(17))).toBe('Good afternoon.');
    expect(resolveGreeting(at(18))).toBe('Good evening.');
  });
});

describe('resolveRunningVerb', () => {
  it('names what the agent is doing, a wait first, and falls back to working on', () => {
    expect(resolveRunningVerb(createTask({ id: 'build', stage: 'building' }))).toBe('building');
    expect(resolveRunningVerb(createTask({ id: 'investigate', stage: 'investigating' }))).toBe(
      'investigating'
    );
    expect(resolveRunningVerb(createTask({ id: 'operate', stage: 'operating' }))).toBe('running');
    expect(resolveRunningVerb(createTask({ id: 'merge', stage: 'awaiting_merge' }))).toBe('working on');
    const usage = { id: 'w', status: 'armed' } as Task['usageWait'];
    expect(resolveRunningVerb(createTask({ id: 'usage', stage: 'building', usageWait: usage }))).toBe(
      'waiting for the usage limit on'
    );
    const monitor = { status: 'armed' } as Task['monitor'];
    expect(resolveRunningVerb(createTask({ id: 'monitor', stage: 'building', monitor }))).toBe(
      'waiting to check in again on'
    );
  });
});

describe('resolvePreview', () => {
  it('shows the first line of the text, or of the detail when there is no text', () => {
    expect(resolvePreview(entry({ text: 'First line\nSecond' }))).toBe('First line');
    expect(resolvePreview(entry({ text: '', detail: 'From the detail\nmore' }))).toBe('From the detail');
    expect(resolvePreview(entry({ text: '', detail: null }))).toBe('');
  });
});

describe('dropPullRequestNumbers', () => {
  it('writes a numbered pull request as the pull request', () => {
    expect(dropPullRequestNumbers('Merge pull request #42 first.')).toBe('Merge the pull request first.');
    expect(dropPullRequestNumbers('Review the PR #7 now.')).toBe('Review the pull request now.');
    expect(dropPullRequestNumbers('Fix its pull request #7.')).toBe('Fix its pull request.');
  });

  it('keeps a capital only where the sentence starts', () => {
    expect(dropPullRequestNumbers('Pull request #42 is clean.')).toBe('The pull request is clean.');
    expect(dropPullRequestNumbers('The PR #3 is clean.')).toBe('The pull request is clean.');
    expect(dropPullRequestNumbers('Its PR #3 is clean.')).toBe('Its pull request is clean.');
    expect(dropPullRequestNumbers('PR #3 is clean.')).toBe('The pull request is clean.');
    expect(dropPullRequestNumbers('It passed. PR #3 is clean.')).toBe(
      'It passed. The pull request is clean.'
    );
  });

  it('keeps an acronym mid-sentence in lower case', () => {
    expect(dropPullRequestNumbers('Merge PR #42 after the review.')).toBe(
      'Merge the pull request after the review.'
    );
  });

  it('leaves text without a numbered pull request alone', () => {
    expect(dropPullRequestNumbers('Open a pull request when ready.')).toBe('Open a pull request when ready.');
    expect(dropPullRequestNumbers('Issue #12 is separate.')).toBe('Issue #12 is separate.');
  });
});
