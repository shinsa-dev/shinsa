import { serializeBase64Url } from '../../packages/core/src/index.ts';
import { AS_COOKIE, GUEST, USER } from './schema.ts';

export function createRandomKey(bytes: number) {
  return serializeBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function readCookie(request: Request, cookie: string) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === cookie) return rest.join('=');
  }
  return null;
}

export function readBearerMachine(request: Request) {
  return (request.headers.get('authorization') ?? '').replace(/^Bearer preview-/, '');
}

export function readPreviewUser(request: Request) {
  const cookie = request.headers.get('cookie') ?? '';
  return cookie.includes(`${AS_COOKIE}=${GUEST.login}`) ? GUEST : USER;
}
