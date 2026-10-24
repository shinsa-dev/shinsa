import { describe, expect, it } from 'bun:test';
import { FALLBACK_PREFIX, scoreCommand } from '@/lib/command/score.ts';

describe('scoreCommand', () => {
  it('shows everything when nothing is typed', () => {
    expect(scoreCommand('go.home', '', ['Home'])).toBe(1);
    expect(scoreCommand('go.home', '   ', ['Home'])).toBe(1);
  });

  it('ranks a whole label over a prefix over a word prefix over a substring', () => {
    const keywords = (label: string) => [label];
    expect(scoreCommand('a', 'merge', keywords('Merge'))).toBe(1);
    expect(scoreCommand('a', 'mer', keywords('Merge #42'))).toBe(0.9);
    expect(scoreCommand('a', 'pull', keywords('Open the pull request'))).toBe(0.8);
    expect(scoreCommand('a', 'ull', keywords('Open the pull request'))).toBe(0.5);
    expect(scoreCommand('a', 'zebra', keywords('Open the pull request'))).toBe(0);
  });

  it('splits words on paths, dots, colons, hashes and dashes', () => {
    expect(scoreCommand('a', 'login', ['feat/login-page'])).toBe(0.8);
    expect(scoreCommand('a', '42', ['Merge #42'])).toBe(0.8);
    expect(scoreCommand('a', 'page', ['feat/login-page'])).toBe(0.8);
  });

  it('ignores case', () => {
    expect(scoreCommand('a', 'MERGE', ['merge'])).toBe(1);
  });

  it('counts hints and keywords at 0.7 of the label', () => {
    expect(scoreCommand('a', 'lgtm', ['Approve the changes', '', 'lgtm'])).toBeCloseTo(0.7);
    expect(
      scoreCommand('a', 'ship', ['Approve the changes', 'Opens the pull request', 'ship it'])
    ).toBeCloseTo(0.63);
  });

  it('prefers the label when it matches better than a keyword', () => {
    expect(scoreCommand('a', 'approve', ['Approve the plan', 'approve'])).toBe(0.9);
  });

  it('averages several words and drops a row when any word misses', () => {
    expect(scoreCommand('a', 'open pull', ['Open the pull request'])).toBeCloseTo(0.85);
    expect(scoreCommand('a', 'open zebra', ['Open the pull request'])).toBe(0);
  });

  it('matches the value itself when there are no keywords', () => {
    expect(scoreCommand('settings', 'sett')).toBe(0.9);
  });

  it('keeps fallback rows at the bottom whatever is typed', () => {
    expect(scoreCommand(`${FALLBACK_PREFIX}create`, 'anything', ['Create task: anything'])).toBe(0.05);
    expect(scoreCommand(`${FALLBACK_PREFIX}create`, '', [])).toBe(0.05);
  });
});
