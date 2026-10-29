import { describe, expect, it } from 'bun:test';
import {
  describeAccessTitle,
  describeAccountSource,
  describeStepHeading,
  describeStepPosition,
  isHighlightKey,
  isImportedNow,
  listChosenValues,
  listFolderRows,
  listFolderSuggestions,
  listReadableRoots,
  listSetupSummary,
  listStepperItems,
  resolveCheckOutcome,
  resolveFolderOptions,
  resolveNextHighlight,
  resolveOnboardingRedirect,
  resolveStepDirection,
  resolveStepState,
  resolveSubmitValues,
  resolveToggledRoots,
} from '@/lib/onboarding.ts';
import { createAccount } from '../support/accounts.ts';
import {
  createFlow,
  createOnboardingStatus,
  createOption,
  createStep,
  createSuggestions,
} from '../support/onboarding.ts';

describe('the setup lock', () => {
  it('sends every page but setup to /onboarding until setup is complete, and nothing once it is', () => {
    const open = createOnboardingStatus({}, false);
    expect(resolveOnboardingRedirect({ name: 'home' }, open)).toBe('/onboarding');
    expect(resolveOnboardingRedirect({ name: 'tasks' }, open)).toBe('/onboarding');
    expect(resolveOnboardingRedirect({ name: 'task', reference: 'SW-1' }, open)).toBe('/onboarding');
    expect(resolveOnboardingRedirect({ name: 'settings' }, open)).toBe('/onboarding');
    expect(resolveOnboardingRedirect({ name: 'onboarding' }, open)).toBeNull();
    expect(resolveOnboardingRedirect({ name: 'tasks' }, createOnboardingStatus())).toBeNull();
    expect(resolveOnboardingRedirect({ name: 'tasks' }, null)).toBeNull();
  });
});

describe('the steps', () => {
  it('counts the step you are on, and the last one once setup is done', () => {
    expect(describeStepPosition(createFlow(createStep()))).toBe('Step 4 of 7');
    expect(describeStepPosition(createFlow(null))).toBe('Step 7 of 7');
  });

  it('names the step you are on for a narrow window, and only the count once setup is done', () => {
    expect(describeStepHeading(createFlow(createStep()))).toBe('Step 4 of 7: Merging');
    expect(describeStepHeading(createFlow(null))).toBe('Step 7 of 7');
  });

  it('checks the answered steps along the top, with the answer as the hint, and holds back the ones not reached', () => {
    const items = listStepperItems(createFlow(createStep({ id: 'model' })));
    expect(items.slice(0, 4)).toEqual([
      { value: 'roots', label: 'Folders', hint: 'Folders answer', checked: true, disabled: false },
      { value: 'projects', label: 'Projects', hint: 'Projects answer', checked: true, disabled: false },
      { value: 'model', label: 'Model', hint: undefined, checked: false, disabled: false },
      { value: 'merge', label: 'Merging', hint: undefined, checked: false, disabled: true },
    ]);
  });

  it('slides back only when you go to an earlier step', () => {
    expect(resolveStepDirection(null, 0)).toBe('forward');
    expect(resolveStepDirection(1, 2)).toBe('forward');
    expect(resolveStepDirection(3, 1)).toBe('back');
  });

  it('marks each step done, current, reached ahead of you or not reached yet', () => {
    const flow = createFlow(createStep({ id: 'model' }));
    const [folders, , model, merge] = flow.steps;
    expect(resolveStepState(folders as never, 0, 2)).toBe('done');
    expect(resolveStepState(model as never, 2, 2)).toBe('current');
    expect(resolveStepState(merge as never, 3, 2)).toBe('upcoming');
    expect(resolveStepState({ id: 'merge', label: 'Merging', summary: null, reached: true }, 2, 1)).toBe(
      'ahead'
    );
    expect(resolveStepState({ id: 'merge', label: 'Merging', summary: 'Squash', reached: true }, 2, 1)).toBe(
      'done'
    );
  });

  it('starts with your earlier answer picked, and sends continue for a step without options', () => {
    const step = createStep({ options: [createOption({ chosen: true }), createOption({ value: 'rebase' })] });
    expect(listChosenValues(step)).toEqual(['squash']);
    expect(resolveSubmitValues(step, ['rebase'])).toEqual(['rebase']);
    expect(resolveSubmitValues(createStep({ id: 'roots', options: [] }), ['/a'])).toEqual(['/a']);
    expect(resolveSubmitValues(createStep({ id: 'accounts', options: [] }), [])).toEqual(['continue']);
  });

  it('lists what you set up, leaving out the steps without an answer to show', () => {
    expect(listSetupSummary(createFlow(createStep({ id: 'plans' })))).toEqual([
      { id: 'roots', label: 'Folders', summary: 'Folders answer' },
      { id: 'projects', label: 'Projects', summary: 'Projects answer' },
      { id: 'model', label: 'Model', summary: 'Model answer' },
      { id: 'merge', label: 'Merging', summary: 'Merging answer' },
    ]);
  });
});

describe('the option list keys', () => {
  it('moves the highlight with the arrows, Home and End, and starts from either end', () => {
    expect(isHighlightKey('ArrowDown')).toBe(true);
    expect(isHighlightKey('Tab')).toBe(false);
    expect(resolveNextHighlight(-1, 'ArrowDown', 3)).toBe(0);
    expect(resolveNextHighlight(-1, 'ArrowUp', 3)).toBe(2);
    expect(resolveNextHighlight(0, 'ArrowDown', 3)).toBe(1);
    expect(resolveNextHighlight(2, 'ArrowDown', 3)).toBe(2);
    expect(resolveNextHighlight(1, 'ArrowUp', 3)).toBe(0);
    expect(resolveNextHighlight(0, 'ArrowUp', 3)).toBe(0);
    expect(resolveNextHighlight(1, 'Home', 3)).toBe(0);
    expect(resolveNextHighlight(1, 'End', 3)).toBe(2);
  });
});

describe('resolveFolderOptions', () => {
  it('adds the folders you typed, picked, after the ones Shinsa found, and never twice', () => {
    const developer = createOption({ value: '/Users/me/Developer', label: '~/Developer' });
    const found = [developer];
    expect(
      resolveFolderOptions(found, ['/Users/me/code', '/Users/me/Developer', '~/oss'], '/Users/me')
    ).toEqual([
      developer,
      { value: '/Users/me/code', label: '~/code', detail: null, chosen: true, recommended: false },
      { value: '~/oss', label: '~/oss', detail: null, chosen: true, recommended: false },
    ]);
  });
});

describe('the accounts step', () => {
  it('says where each account came from and its plan, or that it is signed out', () => {
    expect(describeAccountSource(createAccount({ id: 'a', origin: 'claude', plan: 'max' }))).toBe(
      'Your Claude Code login · Max plan'
    );
    expect(describeAccountSource(createAccount({ id: 'b', origin: 'cswap', plan: null }))).toBe(
      'From claude-swap'
    );
    expect(describeAccountSource(createAccount({ id: 'c', origin: 'login', signIn: 'signed_out' }))).toBe(
      'Signed in through Shinsa · Signed out'
    );
  });

  it('marks the accounts setup imported just now', () => {
    const imported = [{ origin: 'cswap' as const, email: 'Work@acme.dev', plan: null }];
    expect(isImportedNow(createAccount({ id: 'a', email: 'work@acme.dev' }), imported)).toBe(true);
    expect(isImportedNow(createAccount({ id: 'b', email: null }), imported)).toBe(false);
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
    const check = { id: 'codex', label: 'Codex', detail: '', fix: null, command: null };
    expect(resolveCheckOutcome({ ...check, ok: true })).toBe('pass');
    expect(resolveCheckOutcome({ ...check, ok: false })).toBe('fail');
    expect(resolveCheckOutcome({ ...check, ok: false, optional: true })).toBe('skipped');
  });
});

describe('folders macOS keeps private', () => {
  it('names them the way you see them', () => {
    expect(describeAccessTitle(['/Users/me/Documents'], '/Users/me')).toBe('macOS keeps ~/Documents private');
    expect(describeAccessTitle(['/Users/me/Documents', '/Users/me/Desktop'], '/Users/me')).toBe(
      'macOS keeps ~/Documents and ~/Desktop private'
    );
  });

  it('leaves out the private ones however you typed them and keeps the rest', () => {
    expect(
      listReadableRoots(
        ['/Users/me/Developer', '~/Documents/', '/Users/me/Desktop', '~/oss'],
        ['/Users/me/Documents', '/Users/me/Desktop'],
        '/Users/me'
      )
    ).toEqual(['/Users/me/Developer', '~/oss']);
  });
});
