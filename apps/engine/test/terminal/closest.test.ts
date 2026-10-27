import { describe, expect, test } from 'bun:test';
import { selectClosest } from '../../src/terminal/closest.ts';

const WORDS = ['status', 'start', 'stop', 'restart', 'tasks', 'logs', 'do', 'mcp', 'versions', 'version'];

describe('did you mean', () => {
  test('a typo, a swap or a missing letter finds the word that was meant', () => {
    expect(selectClosest('statsu', WORDS)).toBe('status');
    expect(selectClosest('tsaks', WORDS)).toBe('tasks');
    expect(selectClosest('lgos', WORDS)).toBe('logs');
    expect(selectClosest('restrat', WORDS)).toBe('restart');
    expect(selectClosest('STOP', WORDS)).toBe('stop');
    expect(selectClosest('mpc', WORDS)).toBe('mcp');
  });

  test('a start that names one word finds it, an exact word stays itself', () => {
    expect(selectClosest('vers', WORDS)).toBe('version');
    expect(selectClosest('resta', WORDS)).toBe('restart');
    expect(selectClosest('version', WORDS)).toBe('version');
  });

  test('a word too far from every candidate, or a start shared by several, suggests nothing', () => {
    expect(selectClosest('sta', WORDS)).toBeNull();
    expect(selectClosest('launch', WORDS)).toBeNull();
    expect(selectClosest('', WORDS)).toBeNull();
    expect(selectClosest('xy', WORDS)).toBeNull();
  });
});
