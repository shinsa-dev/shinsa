import type { AccountUsage } from '@shinsa/core';
import type { UsageRead } from '../schema.ts';

export function resolveReadUsage(
  result: Extract<UsageRead, { ok: true }>,
  previous: AccountUsage,
  now: number,
  emptyDetail: string
): AccountUsage {
  const found = result.windows.length > 0;
  const fastMode = result.fastMode ?? previous.fastMode;
  const extraUsage = result.extraUsage === undefined ? previous.extraUsage : (result.extraUsage ?? undefined);
  const resetGrants = result.resetGrants ?? previous.resetGrants ?? [];
  return {
    status: found ? 'ok' : 'unavailable',
    windows: result.windows,
    detail: found ? null : emptyDetail,
    checkedAt: now,
    source: 'read',
    ...(fastMode ? { fastMode } : {}),
    ...(extraUsage ? { extraUsage } : {}),
    ...(resetGrants.length > 0 ? { resetGrants } : {}),
  };
}
