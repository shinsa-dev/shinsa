import { DomainError } from '@shinsa/core';
import { describeError } from '../log/redact.ts';
import { OnboardingCallFailed } from './schema.ts';

export function resolveOnboardingFailure(error: unknown): DomainError | OnboardingCallFailed {
  return error instanceof DomainError ? error : new OnboardingCallFailed({ message: describeError(error) });
}
