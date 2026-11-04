import { type AccountPatch, DomainError } from '@shinsa/core';
import { Result } from 'effect';

function isSwitchAt(value: unknown) {
  return value === null || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100);
}

export function parseAccountPatch(value: unknown): Result.Result<AccountPatch, DomainError> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return Result.fail(
      new DomainError({ code: 'patch_invalid', message: 'Say what to change about the account.' })
    );
  }
  const fields = value as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!['isDefault', 'paused', 'switchAt', 'position'].includes(key))
      return Result.fail(new DomainError({ code: 'patch_invalid', message: `No account setting ${key}.` }));
  }
  const patch: AccountPatch = {};
  if (fields.isDefault !== undefined) {
    if (fields.isDefault !== true)
      return Result.fail(
        new DomainError({ code: 'patch_invalid', message: 'Make an account the default instead.' })
      );
    patch.isDefault = true;
  }
  if (fields.paused !== undefined) {
    if (typeof fields.paused !== 'boolean')
      return Result.fail(
        new DomainError({ code: 'patch_invalid', message: 'Say paused with true or false.' })
      );
    patch.paused = fields.paused;
  }
  if (fields.switchAt !== undefined) {
    if (!isSwitchAt(fields.switchAt))
      return Result.fail(
        new DomainError({ code: 'patch_invalid', message: 'Switch accounts at 1 to 100%.' })
      );
    patch.switchAt = fields.switchAt as number | null;
  }
  if (fields.position !== undefined) {
    if (!Number.isInteger(fields.position))
      return Result.fail(
        new DomainError({ code: 'patch_invalid', message: 'Give the position as a whole number.' })
      );
    patch.position = fields.position as number;
  }
  return Result.succeed(patch);
}
