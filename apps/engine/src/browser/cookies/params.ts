import { Duration } from 'effect';
import {
  CHROMIUM_EPOCH_OFFSET_SECONDS,
  type CookieParam,
  PRIORITY,
  SAME_SITE,
  SESSION_COOKIE_LIFETIME,
  type StoredCookieRow,
} from './schema.ts';

export function resolveCookieParam(
  row: StoredCookieRow,
  value: string,
  nowSeconds: number
): CookieParam | null {
  if (row.topFrameSiteKey !== '') return null;
  const expires = row.isPersistent
    ? Math.floor(row.expiresUtc / 1_000_000) - CHROMIUM_EPOCH_OFFSET_SECONDS
    : nowSeconds + Duration.toSeconds(SESSION_COOKIE_LIFETIME);
  if (expires <= nowSeconds) return null;
  const secure = row.isSecure === 1;
  const sameSite = SAME_SITE[row.samesite];
  if (sameSite === 'None' && !secure) return null;
  const hostOnly = !row.hostKey.startsWith('.');
  const scheme = secure ? 'https' : 'http';
  return {
    name: row.name,
    value,
    ...(hostOnly ? { url: `${scheme}://${row.hostKey}${row.path}` } : { domain: row.hostKey }),
    path: row.path,
    secure,
    httpOnly: row.isHttponly === 1,
    ...(sameSite ? { sameSite } : {}),
    expires,
    priority: PRIORITY[row.priority] ?? 'Medium',
  };
}
