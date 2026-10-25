import { describe, expect, it } from 'bun:test';
import { buildLongRun, LONG_CHAT_TASK, listScaledTasks } from './content-scale.ts';
import { median, summarize } from './content-stats.ts';

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
