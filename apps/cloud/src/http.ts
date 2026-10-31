export class CloudError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    this.status = status;
  }
}

const JSON_LIMIT_BYTES = 16 * 1024;

export function respondJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export function respondError(error: CloudError) {
  return respondJson({ error: { code: error.code, message: error.message } }, error.status);
}

export async function readJsonFields(
  request: Request,
  limit = JSON_LIMIT_BYTES
): Promise<Record<string, unknown>> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
    throw new CloudError('content_type_invalid', 'Send the request body as application/json.', 415);
  const text = await request.text();
  if (text.length > limit) throw new CloudError('body_too_large', 'The request body is too large.', 413);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CloudError('body_invalid', 'The request body is not JSON.', 400);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new CloudError('body_invalid', 'The request body must be a JSON object.', 400);
  return value as Record<string, unknown>;
}

export async function readResponseFields(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readText(fields: Record<string, unknown>, name: string, limit = 200) {
  const value = fields[name];
  if (typeof value !== 'string' || value === '' || value.length > limit)
    throw new CloudError('body_invalid', `The field ${name} is missing or too long.`, 400);
  return value;
}

export function assertSameOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin)
    throw new CloudError('forbidden', 'Requests from other sites are not allowed.', 403);
}

export function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function serializeCookie(name: string, value: string, maxAgeSeconds: number) {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function readBearer(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' wss://*.shinsa.dev",
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

export function applySecurityHeaders(response: Response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  return secured;
}
