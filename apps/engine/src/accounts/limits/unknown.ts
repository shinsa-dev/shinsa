import type { AccountUsage } from '@shinsa/core';

export function createUnknownUsage(): AccountUsage {
  return { status: 'unknown', windows: [], detail: null, checkedAt: null, source: null };
}
