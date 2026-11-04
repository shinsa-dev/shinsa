export const API_PREFIX = '/__remote/';

export const HOOKS_PREFIX = '/hooks/';

export const PAGE_METHODS = new Set(['GET', 'HEAD']);

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' blob: wss://*.shinsa.dev",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self' https://github.com",
    "object-src 'none'",
  ].join('; '),
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};
