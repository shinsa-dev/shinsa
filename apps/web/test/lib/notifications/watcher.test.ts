import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test';
import type { DecisionNotice } from '@/lib/notifications/attention.ts';
import { AttentionWatcher } from '@/lib/notifications/watcher.ts';
import { DEFAULT_PREFERENCES, type NotificationPreferences } from '@/lib/preferences/notifications.ts';
import {
  createGate,
  createProject,
  createRepo,
  createShinsaState,
  createTask,
  NOW,
} from '../../support/state.ts';

let hasFocus: ReturnType<typeof spyOn<Document, 'hasFocus'>>;

beforeEach(() => {
  setSystemTime(new Date(NOW));
  hasFocus = spyOn(document, 'hasFocus').mockReturnValue(false);
});

afterEach(() => {
  setSystemTime();
  hasFocus.mockRestore();
});

function setUp(preferences: Partial<NotificationPreferences>) {
  const plays: [string, number][] = [];
  const notices: DecisionNotice[] = [];
  const dismissed: string[] = [];
  const page = { quiet: false, quietTasks: new Set<string>() };
  const watcher = new AttentionWatcher({
    preferences: () => ({ ...DEFAULT_PREFERENCES, ...preferences }),
    play: (soundId, count) => plays.push([soundId, count]),
    notify: (notice) => notices.push(notice),
    dismiss: (tag) => dismissed.push(tag),
    quiet: (notice) => page.quiet || page.quietTasks.has(notice.taskId),
  });
  return { watcher, plays, notices, dismissed, page };
}

function state(gateIds: string[], patch = {}) {
  return createShinsaState({
    tasks: [
      createTask({ id: 't-1', title: 'Paint it', repoId: 'r-1' }),
      createTask({ id: 't-2', title: 'Elsewhere', repoId: 'r-2' }),
    ],
    repos: [createRepo({ id: 'r-1', projectId: 'a-1' }), createRepo({ id: 'r-2', projectId: 'a-2' })],
    projects: [createProject({ id: 'a-1' }), createProject({ id: 'a-2' })],
    gates: gateIds.map((id) =>
      createGate({
        id,
        taskId: id.startsWith('far') ? 't-2' : 't-1',
        type: 'question',
        title: `Question ${id}`,
      })
    ),
    patch,
  });
}

describe('a quiet page', () => {
  it('neither chimes nor notifies while the desktop app has them, and does not ring them later', () => {
    const { watcher, plays, notices, page } = setUp({ sound: 'always', notify: 'always' });
    watcher.observe(state([]));
    page.quiet = true;
    watcher.observe(state(['g-1']));
    page.quiet = false;
    watcher.observe(state(['g-1']));
    expect(plays).toEqual([]);
    expect(notices).toEqual([]);
    watcher.observe(state(['g-1', 'g-2']));
    expect(notices.map((notice) => notice.tag)).toEqual(['g-2']);
  });
});

describe('a page quiet for some tasks only', () => {
  it('notifies about the decisions of the machines it is the one you use on, and chimes once for them', () => {
    const { watcher, plays, notices, page } = setUp({ sound: 'always', notify: 'always' });
    page.quietTasks.add('t-2');
    watcher.observe(state([]));
    watcher.observe(state(['g-1', 'far-1']));
    expect(notices.map((notice) => notice.tag)).toEqual(['g-1']);
    expect(plays).toEqual([['chime', 1]]);
    watcher.observe(state(['g-1', 'far-1', 'far-2']));
    expect(plays).toHaveLength(1);
  });
});

describe('a teammate’s escalation', () => {
  it('chimes and notifies when a teammate’s task is escalated, and closes it once it is not', () => {
    const { watcher, plays, notices, dismissed } = setUp({ sound: 'always', notify: 'always' });
    const escalation = {
      entry: {
        task: createTask({ id: 'k-1', title: 'Fix the checkout' }),
        gates: [],
        project: null,
        repo: null,
        owner: null,
        machine: 'Studio',
        teamId: 'core',
        instanceId: 'm-kai',
      },
      escalation: {
        at: NOW,
        reason: 'Urgent.',
        handoff: {
          waitedMinutes: 60,
          ownerActiveAt: null,
          foundBy: null,
          ratings: null,
          mergesAt: null,
          blockedBy: null,
        },
      },
    };
    watcher.observe(state([]));
    watcher.observe(state([]), [escalation]);
    expect(plays).toEqual([['chime', 1]]);
    expect(notices.map((notice) => [notice.tag, notice.path])).toEqual([
      [`escalation:m-kai k-1:${NOW}`, '/teams/core/m-kai/k-1'],
    ]);
    watcher.observe(state([]), [escalation]);
    expect(notices).toHaveLength(1);
    watcher.observe(state([]));
    expect(dismissed).toEqual([`escalation:m-kai k-1:${NOW}`]);
  });
});

describe('dismissing', () => {
  it('closes the notification of a decision once it no longer needs you, wherever it was answered', () => {
    const { watcher, dismissed } = setUp({ notify: 'always' });
    watcher.observe(state(['g-1', 'g-2']));
    watcher.observe(state(['g-2']));
    expect(dismissed).toEqual(['g-1']);
    watcher.observe(state(['g-2']));
    expect(dismissed).toEqual(['g-1']);
  });
});

describe('chiming and notifying on new decisions', () => {
  it('stays quiet for the first snapshot after a load, then chimes once per burst', () => {
    const { watcher, plays, notices } = setUp({ sound: 'always', notify: 'always' });
    watcher.observe(state(['g-1']));
    expect(plays).toEqual([]);
    watcher.observe(state(['g-1', 'g-2', 'g-3']));
    expect(plays).toEqual([['chime', 2]]);
    expect(notices.map((notice) => notice.body)).toEqual(['Question g-2', 'Question g-3']);
    watcher.observe(state(['g-1', 'g-2', 'g-3']));
    expect(plays).toHaveLength(1);
  });

  it('stays quiet when the notes of an open operation gate change and its id stays the same', () => {
    const { watcher, plays, notices } = setUp({ sound: 'always', notify: 'always' });
    const operation = (notes: string | null) =>
      createShinsaState({
        tasks: [createTask({ id: 't-1', title: 'Backfill', stage: 'awaiting_operation' })],
        gates: [
          createGate({
            id: 'g-1',
            taskId: 't-1',
            type: 'operation',
            title: 'The change merged. Run the operation now?',
            commit: 'f00dfacecafe',
            notes,
          }),
        ],
      });
    watcher.observe(createShinsaState({ tasks: [createTask({ id: 't-1', stage: 'awaiting_operation' })] }));
    watcher.observe(operation(null));
    watcher.observe(operation('Wait for the deploy.'));
    watcher.observe(operation('Wait for the deploy, then skip the cache.'));
    expect(plays).toEqual([['chime', 1]]);
    expect(notices.map((notice) => notice.tag)).toEqual(['g-1']);
  });

  it('stays quiet about decisions outside the focus project, and when the focus lifts', () => {
    const { watcher, plays } = setUp({ sound: 'always' });
    const focus = { focus: { projectIds: ['a-1'], except: false, teamId: null, until: NOW + 60_000 } };
    watcher.observe(state([], focus));
    watcher.observe(state(['far-1'], focus));
    expect(plays).toEqual([]);
    watcher.observe(state(['far-1']));
    expect(plays).toEqual([]);
  });

  it('follows each setting: never, only in the background, or always', () => {
    const quiet = setUp({ sound: 'never', notify: 'never' });
    quiet.watcher.observe(state([]));
    quiet.watcher.observe(state(['g-1']));
    expect([quiet.plays, quiet.notices]).toEqual([[], []]);

    hasFocus.mockReturnValue(true);
    const looking = setUp({ sound: 'unfocused', notify: 'unfocused', soundId: 'pop' });
    looking.watcher.observe(state([]));
    looking.watcher.observe(state(['g-1']));
    expect([looking.plays, looking.notices]).toEqual([[], []]);

    hasFocus.mockReturnValue(false);
    const away = setUp({ sound: 'unfocused', notify: 'unfocused', soundId: 'pop' });
    away.watcher.observe(state([]));
    away.watcher.observe(state(['g-1']));
    expect(away.plays).toEqual([['pop', 1]]);
    expect(away.notices).toHaveLength(1);
  });
});
