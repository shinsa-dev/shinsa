import { describe, expect, it } from 'bun:test';
import { buildLongRun, LONG_CHAT_TASK, listScaledTasks } from './content-scale.ts';
import {
  median,
  summarize,
  summarizeBlankScroll,
  summarizeReveal,
  summarizeRowPushes,
} from './content-stats.ts';

describe('median and summarize', () => {
  it('takes the middle sample, or the mean of the two middle ones, to a tenth', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4.15])).toBe(2.5);
  });

  it('summarizes every key the samples report', () => {
    expect(summarize([{ a: 1, b: 4 }, { a: 3 }, { a: 2, b: 6 }])).toEqual({ a: 2, b: 5 });
  });
});

describe('the scaled data', () => {
  it('names each extra task and builds a run of about forty entries, ended unless live', () => {
    const tasks = listScaledTasks(40);
    expect(tasks).toHaveLength(40);
    expect(new Set(tasks.map((task) => task.title)).size).toBe(40);
    expect(LONG_CHAT_TASK.id).toBe('perf-long-chat');
    const ended = buildLongRun(3, false);
    const live = buildLongRun(3, true);
    expect(ended.length).toBe(live.length + 2);
    expect(ended.at(-1)).toEqual({ type: 'status', status: 'ended', outcome: 'completed' });
    expect(ended.filter((event) => event.type === 'tool_call')).toHaveLength(15);
  });
});

describe('the All tasks scroll and pushes', () => {
  it('counts the frames that showed blank list and how much of the viewport was blank', () => {
    expect(summarizeBlankScroll([0, 120, 0, 400], [16.7, 16.6, 33.4, 16.7], 800)).toEqual({
      frames: 4,
      blankFrames: 2,
      blankPxMax: 400,
      blankShareMax: 50,
      blankPxTotal: 520,
      frameMax: 33.4,
      framesOver20: 1,
    });
    expect(summarizeBlankScroll([], [], 0)).toMatchObject({ frames: 0, blankPxMax: 0, blankShareMax: 0 });
  });

  it('takes the median rows and components a push re-rendered', () => {
    const pushes = [
      { ms: 12, components: 300, rows: 30 },
      { ms: 20, components: 320, rows: 31 },
      { ms: 15, components: 310, rows: 30 },
    ];
    expect(summarizeRowPushes(pushes, 31)).toEqual({
      pushes: 3,
      visibleRows: 31,
      pushMs: 15,
      pushMaxMs: 20,
      pushComponents: 310,
      pushRows: 30,
    });
  });

  it('counts the frames after a reveal that showed fewer rows than it settled on', () => {
    expect(summarizeReveal([0, 8, 15, 15])).toEqual({
      revealRows: 15,
      revealFirstRowFrame: 1,
      revealFullFrame: 2,
      revealShortFrames: 2,
    });
  });
});
