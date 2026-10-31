import { describe, expect, test } from 'bun:test';
import type { OnboardingCheck } from '@shinsa/core';
import { listFailingChecks, resolveHelpRequest, resolveWelcomeBody } from '../../src/onboarding/welcome.ts';

function createCheck(overrides: Partial<OnboardingCheck>): OnboardingCheck {
  return { id: 'git', label: 'Git', ok: true, detail: 'git 2.0', fix: null, command: null, ...overrides };
}

const MISSING_GH = createCheck({
  id: 'gh',
  label: 'GitHub CLI',
  ok: false,
  detail: 'Not installed.',
  command: 'brew install gh',
});

const MISSING_CODEX = createCheck({
  id: 'codex',
  label: 'Codex',
  ok: false,
  optional: true,
  detail: 'Not installed.',
});

describe('the welcome', () => {
  test('lists each step’s answer, and says when every tool is installed', () => {
    const body = resolveWelcomeBody(
      [
        { label: 'Folders', summary: '~/Developer' },
        { label: 'Projects', summary: null },
      ],
      [createCheck({}), MISSING_CODEX]
    );
    expect(body).toContain(
      '- **Folders:** ~/Developer\n- **Projects:** None yet\n- **Tools:** Everything Shinsa needs is installed.'
    );
    expect(body).toContain('## What happens next');
  });

  test('names the tools still missing, leaving out the optional ones', () => {
    const body = resolveWelcomeBody([], [MISSING_GH, MISSING_CODEX]);
    expect(body).toContain(
      '- **Tools:** Still missing GitHub CLI. Run setup again from Settings to install them.'
    );
  });
});

describe('asking for help', () => {
  test('lists only the required checks that fail', () => {
    expect(listFailingChecks([createCheck({}), MISSING_GH, MISSING_CODEX])).toEqual([MISSING_GH]);
  });

  test('names each check, what went wrong and the command Shinsa would run', () => {
    const request = resolveHelpRequest([
      MISSING_GH,
      createCheck({ ok: false, detail: 'It did not answer in time.' }),
    ]);
    expect(request).toStartWith('Help me finish setting up Shinsa on this Mac.');
    expect(request).toContain(
      "- GitHub CLI: Not installed. Shinsa's fix is `brew install gh`.\n- Git: It did not answer in time.\n"
    );
  });
});
