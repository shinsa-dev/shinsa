import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import { selectWorkArea, selectWorkPathArea } from '../../src/autopilot/work/area.ts';
import { selectWorkNovelty } from '../../src/autopilot/work/novelty.ts';
import { resolveWorkSize } from '../../src/autopilot/work/size.ts';
import { selectWorkSurface } from '../../src/autopilot/work/surface.ts';
import { listWorkTerms, resolveWorkTermHash } from '../../src/autopilot/work/terms.ts';
import { AUTOPILOT_WORK_LIMITS, resolveAutopilotWorkFacts } from '../../src/index.ts';
import type { PlanDocument } from '../../src/index.ts';
import { PLAN } from '../harness.ts';

function plan(paths: string[], document: Partial<PlanDocument> = {}) {
  return {
    document: { ...PLAN, ...document, files: paths.map((path) => ({ path, change: 'Change it.' })) },
  } as never;
}

describe('the area of the app a change works in', () => {
  test('is the workspace and its first named folder', () => {
    expect(Option.getOrNull(selectWorkPathArea('apps/web/src/components/settings/autopilot.tsx'))).toBe(
      'apps/web/settings'
    );
    expect(Option.getOrNull(selectWorkPathArea('packages/core/src/autopilot/profile.ts'))).toBe(
      'packages/core/autopilot'
    );
    expect(Option.getOrNull(selectWorkPathArea('apps/engine/src/store/migrations/list.ts'))).toBe(
      'apps/engine/store'
    );
  });

  test('falls back to the file name, and keeps a folder outside a workspace as its root', () => {
    expect(Option.getOrNull(selectWorkPathArea('apps/web/src/lib/Autopilot.ts'))).toBe('apps/web/autopilot');
    expect(Option.getOrNull(selectWorkPathArea('docs/engine.md'))).toBe('docs/engine');
    expect(Option.getOrNull(selectWorkPathArea('./README.md'))).toBe('readme');
    expect(Option.getOrNull(selectWorkPathArea('scripts/seed/autopilot.ts'))).toBe('scripts/seed');
    expect(Option.isNone(selectWorkPathArea(''))).toBe(true);
  });

  test('is where most of the code changes, leaving docs, changelog and tests aside', () => {
    expect(
      Option.getOrNull(
        selectWorkArea([
          'packages/core/test/autopilot/work.test.ts',
          'docs/engine.md',
          '.changes/autopilot.md',
          'apps/web/src/components/settings/autopilot.tsx',
          'apps/web/src/components/settings/agents.tsx',
          'packages/core/src/autopilot/profile.ts',
        ])
      )
    ).toBe('apps/web/settings');
  });

  test('reads the docs when a change is only docs, and is unknown without paths', () => {
    expect(Option.getOrNull(selectWorkArea(['docs/engine.md', 'docs/engine.md', 'docs/spec.md']))).toBe(
      'docs/engine'
    );
    expect(Option.isNone(selectWorkArea([]))).toBe(true);
  });
});

describe('whether a change is UI or logic', () => {
  test('reads components, routes and styles as UI and the rest as logic', () => {
    expect(
      Option.getOrNull(selectWorkSurface(['apps/web/src/components/a.tsx', 'apps/web/src/styles/a.css']))
    ).toBe('ui');
    expect(
      Option.getOrNull(selectWorkSurface(['packages/core/src/a.ts', 'apps/engine/src/b.ts', 'docs/x.md']))
    ).toBe('logic');
    expect(Option.getOrNull(selectWorkSurface(['apps/web/src/routes/a.tsx', 'packages/core/src/a.ts']))).toBe(
      'mixed'
    );
  });

  test('is docs when only docs change, and unknown without paths', () => {
    expect(Option.getOrNull(selectWorkSurface(['docs/engine.md', '.changes/a.md']))).toBe('docs');
    expect(Option.isNone(selectWorkSurface([]))).toBe(true);
  });
});

describe('whether the work is new or a tweak', () => {
  test('a new flow is new, a small dialog is a tweak, and an even mix is unknown', () => {
    expect(Option.getOrNull(selectWorkNovelty('Build a new onboarding flow'))).toBe('new');
    expect(Option.getOrNull(selectWorkNovelty('Add a small confirm dialog'))).toBe('tweak');
    expect(Option.getOrNull(selectWorkNovelty('Fix the new label'))).toBe('tweak');
    expect(Option.getOrNull(selectWorkNovelty('Fix the new flow'))).toBe('new');
    expect(Option.isNone(selectWorkNovelty('Add a dialog'))).toBe(true);
  });
});

describe('the size of the work', () => {
  test('follows the plan’s phases and files', () => {
    expect(resolveWorkSize({ phases: 2, files: 4 })).toBe('small');
    expect(resolveWorkSize({ phases: 3, files: 4 })).toBe('medium');
    expect(resolveWorkSize({ phases: 5, files: 1 })).toBe('large');
    expect(resolveWorkSize({ phases: 1, files: 12 })).toBe('large');
  });
});

describe('the request as hashed terms', () => {
  test('is the same for the same words, in any order or case, and drops short and common words', () => {
    expect(listWorkTerms('Confirm the dialog')).toEqual(listWorkTerms('dialog CONFIRM'));
    expect(listWorkTerms('Add dialogs')).toEqual(listWorkTerms('add dialog'));
    expect(listWorkTerms('the and to of a')).toEqual([]);
  });

  test('holds each bucket once, sorted, within the bucket count and the limit', () => {
    const terms = listWorkTerms('dialog dialog dialogs modal');
    expect(terms).toEqual([...new Set(terms)].sort((a, b) => a - b));
    expect(terms).toHaveLength(2);
    const many = listWorkTerms(Array.from({ length: 80 }, (_, index) => `word${index}`).join(' '));
    expect(many).toHaveLength(AUTOPILOT_WORK_LIMITS.terms);
    expect(many.every((term) => term >= 0 && term < AUTOPILOT_WORK_LIMITS.termBuckets)).toBe(true);
    expect(resolveWorkTermHash('dialog')).toBe(resolveWorkTermHash('dialog'));
  });

  test('roots plural, past and running forms together', () => {
    expect(listWorkTerms('fixing')).toEqual(listWorkTerms('fix'));
    expect(listWorkTerms('renamed')).toEqual(listWorkTerms('renam'));
    expect(listWorkTerms('classes')).toEqual(listWorkTerms('class'));
    expect(listWorkTerms('class')).not.toEqual(listWorkTerms('clas'));
  });

  test('reads only the start of a long request', () => {
    const start = 'onboarding '.repeat(AUTOPILOT_WORK_LIMITS.requestCharacters / 11 + 1);
    expect(listWorkTerms(`${start} payments`)).toEqual(listWorkTerms('onboarding'));
  });
});

describe('the work facts of a task', () => {
  test('tell a small confirm dialog from a new onboarding flow', () => {
    const dialog = resolveAutopilotWorkFacts({
      title: 'Add a small confirm dialog',
      request: 'Ask before deleting a project.',
      plan: plan(['apps/web/src/components/projects/delete-dialog.tsx']),
    });
    const flow = resolveAutopilotWorkFacts({
      title: 'Build a new onboarding flow',
      request: 'Walk a new user through setup.',
      plan: plan(
        [
          'apps/web/src/routes/onboarding.tsx',
          'apps/web/src/components/onboarding/steps.tsx',
          'apps/web/src/components/onboarding/welcome.tsx',
          'packages/core/src/onboarding/state.ts',
        ],
        {
          phases: [1, 2, 3, 4, 5].map((index) => ({ title: `Step ${index}`, detail: 'Do it.' })),
        }
      ),
    });
    expect(dialog).toMatchObject({
      area: 'apps/web/projects',
      surface: 'ui',
      novelty: 'tweak',
      size: 'small',
    });
    expect(flow).toMatchObject({ area: 'apps/web/onboarding', surface: 'ui', novelty: 'new', size: 'large' });
    expect(dialog.terms).not.toEqual(flow.terms);
  });

  test('without a plan know only the words of the request', () => {
    const facts = resolveAutopilotWorkFacts({
      title: 'Why is the build slow?',
      request: 'It takes ages.',
      plan: null,
    });
    expect(facts).toEqual({
      area: null,
      surface: null,
      novelty: null,
      size: null,
      terms: listWorkTerms('Why is the build slow?\nIt takes ages.'),
    });
  });

  test('read the plan’s goal for whether the work is new', () => {
    const facts = resolveAutopilotWorkFacts({
      title: 'Onboarding',
      request: 'See the plan.',
      plan: plan([], { goal: 'Build a new onboarding flow.' }),
    });
    expect(facts.novelty).toBe('new');
  });
});
