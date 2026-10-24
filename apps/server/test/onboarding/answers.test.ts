import { describe, expect, test } from 'bun:test';
import {
  isSkip,
  matchChoices,
  parseConfirmation,
  resolveConfirmedChoice,
} from '../../src/onboarding/answers.ts';
import type { Asked } from '../../src/onboarding/questions.ts';

function createAsked(choices: [string, string][], multiple = false): Asked {
  return {
    text: '',
    checks: [],
    choices: choices.map(([value, label]) => ({ value, label, detail: null, chosen: false })),
    multiple,
    submitLabel: null,
    placeholder: '',
    retry: '',
  };
}

const MERGE = createAsked([
  ['squash', 'Squash'],
  ['merge', 'Merge commit'],
  ['rebase', 'Rebase'],
]);

const PLANS = createAsked([
  ['yes', 'Yes, for large tasks'],
  ['no', 'No, start building'],
]);

const FOLDERS = createAsked(
  [
    ['/Users/me/Developer/Projects', '~/Developer/Projects'],
    ['/Users/me/Developer/Superwall', '~/Developer/Superwall'],
    ['/Users/me/Work/Projects', '~/Work/Projects'],
    ['/Users/me/Sandbox', '~/Sandbox'],
  ],
  true
);

describe('reading a setup answer without the model', () => {
  test('parseConfirmation reads yes and no in your own words, and nothing else', () => {
    for (const text of [
      'yes',
      'Y',
      'Yes please!',
      'yep, that’s right',
      'Looks good, thanks.',
      'sure thing',
      'ok',
    ]) {
      expect(parseConfirmation(text)).toBe('yes');
    }
    for (const text of [
      'no',
      'Nope.',
      'not quite',
      'not right',
      'no, that is wrong',
      'ask again',
      'try again',
    ]) {
      expect(parseConfirmation(text)).toBe('no');
    }
    for (const text of ['yes, opus', 'no, the cheap one', 'not opus', '!!!', '', 'yes no']) {
      expect(parseConfirmation(text)).toBeNull();
    }
  });

  test('reads a contraction typed without its apostrophe', () => {
    expect(isSkip('i dont mind')).toBe(true);
    expect(isSkip('doesnt matter')).toBe(true);
    expect(parseConfirmation('thats right')).toBe('yes');
    expect(parseConfirmation('no it isnt')).toBe('no');
  });

  test('isSkip reads skipping, having no preference and keeping the current setting', () => {
    for (const text of [
      'skip',
      'Skip for now please',
      'later',
      'no idea',
      'I don’t mind',
      'you decide',
      'keep it as is',
      'use the default',
      'the current one',
    ]) {
      expect(isSkip(text)).toBe(true);
    }
    for (const text of ['skip the tests', 'squash', 'keep merge commits', 'no']) {
      expect(isSkip(text)).toBe(false);
    }
  });

  test('resolveConfirmedChoice takes yes or no as that option, as going on with the option shown first, or as keeping what is saved', () => {
    expect(resolveConfirmedChoice('yes please', PLANS)).toEqual(['yes']);
    expect(resolveConfirmedChoice('nope', PLANS)).toEqual(['no']);
    const accounts = createAsked([
      ['continue', 'Use these accounts'],
      ['recheck', 'Check again'],
    ]);
    expect(resolveConfirmedChoice('looks good', accounts)).toEqual(['continue']);
    expect(resolveConfirmedChoice('no', accounts)).toBeNull();
    const signedOut = createAsked([
      ['recheck', 'Check again'],
      ['continue', 'Skip for now'],
    ]);
    expect(resolveConfirmedChoice('sure thing', signedOut)).toBeNull();
    expect(resolveConfirmedChoice('sure thing', MERGE)).toBe('keep');
    expect(resolveConfirmedChoice('yes please', createAsked([['recheck', 'Check again']]))).toBe('keep');
    expect(resolveConfirmedChoice('nope', MERGE)).toBeNull();
    expect(resolveConfirmedChoice('yes', FOLDERS)).toBeNull();
    expect(resolveConfirmedChoice('use squash', MERGE)).toBeNull();
  });

  test('matchChoices takes the one option a sentence starts with and names alone', () => {
    expect(matchChoices(' SQUASH. ', MERGE)).toEqual(['squash']);
    expect(matchChoices('merge commit.', MERGE)).toEqual(['merge']);
    expect(matchChoices('Rebase please', MERGE)).toEqual(['rebase']);
    expect(matchChoices('I’d like squash merges', MERGE)).toEqual(['squash']);
    expect(matchChoices('merge commits, thanks', MERGE)).toEqual(['merge']);
    expect(matchChoices('yes always approve plans', PLANS)).toEqual(['yes']);
    expect(matchChoices('no, only when I ask', PLANS)).toEqual(['no']);
    for (const text of [
      'squash or rebase',
      'not squash',
      'keep history linear, rebase',
      'rebase but not today',
      'squash merge',
      '~/a',
    ]) {
      expect(matchChoices(text, MERGE)).toBeNull();
    }
  });

  test('matchChoices takes folders by their paths or their names where folders are asked', () => {
    expect(matchChoices('~/a,\n/b and ~/c', FOLDERS)).toEqual(['~/a', '/b', '~/c']);
    expect(matchChoices('the superwall and sandbox folders', FOLDERS)).toEqual([
      '/Users/me/Developer/Superwall',
      '/Users/me/Sandbox',
    ]);
    expect(matchChoices('sandbox, sandbox', FOLDERS)).toEqual(['/Users/me/Sandbox']);
    expect(matchChoices('the projects folder', FOLDERS)).toBeNull();
    expect(matchChoices('sandbox and my work stuff', FOLDERS)).toBeNull();
    expect(matchChoices('the folders', FOLDERS)).toBeNull();
    expect(matchChoices(',', FOLDERS)).toBeNull();
  });
});
