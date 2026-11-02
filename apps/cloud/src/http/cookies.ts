import { Duration } from 'effect';

export function serializeCookie(name: string, value: string, maxAge: Duration.Duration) {
  return `${name}=${value}; Path=/; Max-Age=${Duration.toSeconds(maxAge)}; HttpOnly; Secure; SameSite=Lax`;
}

export function serializeExpiredCookie(name: string) {
  return serializeCookie(name, '', Duration.zero);
}
