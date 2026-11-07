import { describe, expect, test } from 'bun:test';
import { DomainError } from '@shinsa/core';
import { resolveOnboardingFailure } from '../../src/onboarding/failures.ts';

describe('resolveOnboardingFailure', () => {
  test('keeps a refusal the engine gave and wraps anything else as a failed call', () => {
    const refused = new DomainError({ code: 'project_exists', message: 'That project already exists.' });
    expect(resolveOnboardingFailure(refused)).toBe(refused);
    const wrapped = resolveOnboardingFailure(new Error('disk full'));
    expect(wrapped._tag).toBe('OnboardingCallFailed');
    expect(wrapped).toMatchObject({ message: 'disk full' });
  });
});
