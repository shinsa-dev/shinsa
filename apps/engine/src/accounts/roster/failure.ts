import { DomainError } from '@shinsa/core';
import { describeError } from '../../log/redact.ts';
import { AccountStepFailed, type AccountsFailure } from './schema.ts';

export function resolveAccountFailure(error: unknown): AccountsFailure {
  if (error instanceof DomainError || error instanceof AccountStepFailed) return error;
  return new AccountStepFailed({ message: describeError(error) });
}
