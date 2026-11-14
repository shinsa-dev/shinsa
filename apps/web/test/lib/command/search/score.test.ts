import { describe, expect, it } from 'bun:test';
import { Option } from 'effect';
import {
  createSearchField,
  KEYWORD_WEIGHT,
  listKeywordFields,
  listMatchRanges,
  parseQueryWords,
  scoreFields,
  scoreKeywords,
  selectWordMatch,
} from '@/lib/command/search/score.ts';

function scoreOf(text: string, word: string, fuzzy = true) {
  return Option.match(selectWordMatch(createSearchField(text, 1, fuzzy), word), {
    onNone: () => 0,
    onSome: (match) => match.score,
  });
}

describe('parseQueryWords', () => {
  it('lowers the query and splits it on spaces', () => {
    expect(parseQueryWords('  Fix   LOGIN ')).toEqual(['fix', 'login']);
    expect(parseQueryWords('   ')).toEqual([]);
  });
});

describe('selectWordMatch', () => {
  it('ranks a whole text over a prefix over a word prefix over a substring over a fuzzy match', () => {
    expect(scoreOf('Merge', 'merge')).toBe(1);
    expect(scoreOf('Merge #42', 'mer')).toBe(0.9);
    expect(scoreOf('Open the pull request', 'pull')).toBe(0.8);
    expect(scoreOf('Open the pull request', 'ull')).toBe(0.6);
    const fuzzy = scoreOf('Open the pull request', 'opr');
    expect(fuzzy).toBeGreaterThan(0.2);
    expect(fuzzy).toBeLessThanOrEqual(0.5);
    expect(scoreOf('Open the pull request', 'zebra')).toBe(0);
  });

  it('finds a task by the first letters of its words', () => {
    expect(scoreOf('Fix decide invariant violations', 'fdv')).toBeGreaterThan(0);
    expect(selectWordMatch(createSearchField('Fix decide', 1, true), 'fxd')).toEqual(
      Option.some({
        score: expect.any(Number),
        ranges: [
          { start: 0, end: 1 },
          { start: 2, end: 3 },
          { start: 4, end: 5 },
        ],
      })
    );
  });

  it('finds a handle typed without its dash, and its number alone', () => {
    expect(scoreOf('LOC-287', 'loc287')).toBeGreaterThan(0.2);
    expect(scoreOf('LOC-287', '287')).toBe(0.8);
    expect(scoreOf('LOC287', '287')).toBe(0.8);
  });

  it('drops a fuzzy match whose letters mostly land inside words', () => {
    expect(scoreOf('the perspective skill', 'prev')).toBe(0);
    expect(scoreOf('Fix the login redirect', 'frd')).toBeGreaterThan(0);
  });

  it('starts a fuzzy match only at the start of a word', () => {
    expect(scoreOf('Open the pull request', 'pnr')).toBe(0);
    expect(scoreOf('Rework billing', 'eob')).toBe(0);
  });

  it('prefers the tighter fuzzy match', () => {
    expect(scoreOf('feat/login-page', 'flp')).toBeGreaterThan(scoreOf('feat/a login z page', 'flp'));
    expect(scoreOf('Fix login', 'filo')).toBeGreaterThan(scoreOf('Final ok login', 'filo'));
  });

  it('keeps fuzzy matching to fuzzy fields and to words of two letters or more', () => {
    expect(scoreOf('Fix decide', 'fxd', false)).toBe(0);
    expect(scoreOf('Fix decide', 'q')).toBe(0);
  });

  it('splits words on paths, dots, colons, hashes and dashes', () => {
    expect(scoreOf('feat/login-page', 'login')).toBe(0.8);
    expect(scoreOf('Merge #42', '42')).toBe(0.8);
    expect(scoreOf('feat/login-page', 'page')).toBe(0.8);
  });
});

describe('scoreFields', () => {
  it('shows everything when nothing is typed', () => {
    expect(scoreFields([], [])).toBe(1);
  });

  it('weighs each field and keeps its best match for each word', () => {
    const fields = [createSearchField('Approve the plan', 1, true), createSearchField('lgtm', 0.7, false)];
    expect(scoreFields(fields, ['lgtm'])).toBeCloseTo(0.7);
    expect(scoreFields(fields, ['approve'])).toBe(0.9);
  });

  it('averages several words and drops a row when any word misses', () => {
    const fields = [createSearchField('Open the pull request', 1, true)];
    expect(scoreFields(fields, ['open', 'pull'])).toBeCloseTo(0.85);
    expect(scoreFields(fields, ['open', 'zebra'])).toBe(0);
  });
});

describe('listKeywordFields and scoreKeywords', () => {
  it('matches the label fuzzily and every other keyword plainly, at 0.7', () => {
    const fields = listKeywordFields(['Approve the changes', '', 'ship it']);
    expect(fields.map((field) => [field.text, field.weight, field.fuzzy])).toEqual([
      ['Approve the changes', 1, true],
      ['ship it', KEYWORD_WEIGHT, false],
    ]);
    expect(scoreKeywords(['Approve the changes', 'ship it'], 'ship')).toBeCloseTo(0.63);
    expect(scoreKeywords(['Approve the changes'], 'apc')).toBeGreaterThan(0);
    expect(scoreKeywords(['Home', 'shipping it'], 'shp')).toBe(0);
    expect(scoreKeywords([], 'home')).toBe(0);
  });
});

describe('listMatchRanges', () => {
  it('marks what each word matched, merging neighbours', () => {
    expect(listMatchRanges('Fix the login redirect', 'login fix')).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 13 },
    ]);
    expect(listMatchRanges('Fix decide', 'fxd').length).toBe(3);
    expect(listMatchRanges('abc', 'ab bc')).toEqual([{ start: 0, end: 3 }]);
  });

  it('marks nothing for a word that does not match', () => {
    expect(listMatchRanges('Fix login', 'zebra')).toEqual([]);
    expect(listMatchRanges('Fix login', '')).toEqual([]);
  });
});
