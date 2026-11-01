import { type AccountPatch, DomainError } from '@shinsa/core';

function isSwitchAt(value: unknown) {
  return value === null || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100);
}

export function parseAccountPatch(value: unknown): AccountPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('patch_invalid', 'Say what to change about the account.');
  }
  const fields = value as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!['isDefault', 'paused', 'switchAt', 'position'].includes(key))
      throw new DomainError('patch_invalid', `No account setting ${key}.`);
  }
  const patch: AccountPatch = {};
  if (fields.isDefault !== undefined) {
    if (fields.isDefault !== true)
      throw new DomainError('patch_invalid', 'Make an account the default instead.');
    patch.isDefault = true;
  }
  if (fields.paused !== undefined) {
    if (typeof fields.paused !== 'boolean')
      throw new DomainError('patch_invalid', 'Say paused with true or false.');
    patch.paused = fields.paused;
  }
  if (fields.switchAt !== undefined) {
    if (!isSwitchAt(fields.switchAt)) throw new DomainError('patch_invalid', 'Switch accounts at 1 to 100%.');
    patch.switchAt = fields.switchAt as number | null;
  }
  if (fields.position !== undefined) {
    if (!Number.isInteger(fields.position))
      throw new DomainError('patch_invalid', 'Give the position as a whole number.');
    patch.position = fields.position as number;
  }
  return patch;
}
