import { describe, expect, it } from 'bun:test';
import {
  describeOnboardingStep,
  listFolderRows,
  listFolderSuggestions,
  resolveCheckOutcome,
  resolveToggledRoots,
} from '@/lib/onboarding.ts';
import { createOnboardingStatus, createPrompt, createSuggestions } from '../support/onboarding.ts';

describe('describeOnboardingStep', () => {
  it('counts the questions, and says when setup is done', () => {
    expect(describeOnboardingStep(createPrompt({ step: 2, steps: 6 }))).toBe('Question 2 of 6');
    expect(describeOnboardingStep(null)).toBe('Setup is done.');
  });
});

describe('listFolderRows', () => {
  it('lists the chosen folders, then the ones from SHINSA_ROOTS that cannot be removed here', () => {
    const status = createOnboardingStatus({
      configured: ['/Users/me/Developer', '/srv/code'],
      fromEnvironment: ['/srv/code', '/Users/me/work'],
    });
    expect(listFolderRows(status)).toEqual([
      { path: '/Users/me/Developer', label: '~/Developer', removable: true },
      { path: '/srv/code', label: '/srv/code', removable: true },
      { path: '/Users/me/work', label: '~/work', removable: false },
    ]);
  });
});

describe('listFolderSuggestions', () => {
  it('labels each found folder with its repositories and marks the chosen ones', () => {
    const status = createOnboardingStatus({ configured: ['/Users/me/Developer'] });
    const { suggestions } = createSuggestions([
      ['/Users/me/Developer', 12],
      ['/Users/me/oss', 1],
    ]);
    expect(listFolderSuggestions(status, suggestions)).toEqual([
      { path: '/Users/me/Developer', label: '~/Developer', detail: '12 repositories', chosen: true },
      { path: '/Users/me/oss', label: '~/oss', detail: '1 repository', chosen: false },
    ]);
  });
});

describe('resolveToggledRoots', () => {
  it('adds a folder that is not chosen and removes one that is', () => {
    expect(resolveToggledRoots(['/a'], '/b')).toEqual(['/a', '/b']);
    expect(resolveToggledRoots(['/a', '/b'], '/a')).toEqual(['/b']);
  });
});

describe('resolveCheckOutcome', () => {
  it('a missing optional tool is skipped, not failed', () => {
    const check = { id: 'codex', label: 'Codex', detail: '', fix: null };
    expect(resolveCheckOutcome({ ...check, ok: true })).toBe('pass');
    expect(resolveCheckOutcome({ ...check, ok: false })).toBe('fail');
    expect(resolveCheckOutcome({ ...check, ok: false, optional: true })).toBe('skipped');
  });
});
