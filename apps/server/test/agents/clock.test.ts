import { describe, expect, test } from 'bun:test';
import { RunClock } from '../../src/agents/clock.ts';

describe('RunClock', () => {
  test('expires after the limit', async () => {
    let expired = false;
    new RunClock(10, () => {
      expired = true;
    }).start();
    await Bun.sleep(30);
    expect(expired).toBe(true);
  });

  test('time spent paused does not count, and overlapping pauses resume only once all end', async () => {
    let expired = false;
    const clock = new RunClock(40, () => {
      expired = true;
    });
    clock.start();
    clock.pause();
    clock.pause();
    await Bun.sleep(60);
    clock.resume();
    await Bun.sleep(30);
    expect(expired).toBe(false);
    clock.resume();
    clock.resume();
    await Bun.sleep(60);
    expect(expired).toBe(true);
  });

  test('a stopped clock never fires, even when resumed', async () => {
    let expired = false;
    const clock = new RunClock(10, () => {
      expired = true;
    });
    clock.start();
    clock.pause();
    clock.stop();
    clock.resume();
    clock.stop();
    await Bun.sleep(30);
    expect(expired).toBe(false);
  });
});
