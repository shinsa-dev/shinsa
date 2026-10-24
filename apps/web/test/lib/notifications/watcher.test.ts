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
  const watcher = new AttentionWatcher({
    preferences: () => ({ ...DEFAULT_PREFERENCES, ...preferences }),
    play: (soundId, count) => plays.push([soundId, count]),
    notify: (notice) => notices.push(notice),
  });
  return { watcher, plays, notices };
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
    expect(notices.map((notice) => notice.gateId)).toEqual(['g-1']);
  });

  it('stays quiet about decisions outside the focus project, and when the focus lifts', () => {
    const { watcher, plays } = setUp({ sound: 'always' });
    const focus = { focus: { projectId: 'a-1', until: NOW + 60_000 } };
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
