import type { McpTransport } from '@shinsa/core';

export interface McpDefinition {
  transport: McpTransport;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  url: string | null;
  headers: Record<string, string>;
  bearerTokenEnv: string | null;
}

type Fields = Record<string, unknown>;

export type Env = Record<string, string | undefined>;

const HEADLESS_BROWSER_ENV = { PLAYWRIGHT_MCP_HEADLESS: 'true' };

const RETINA_BROWSER_ENV = { PLAYWRIGHT_MCP_DEVICE: 'Desktop Chrome HiDPI' };

const DEVICE_CHOICES = [
  'PLAYWRIGHT_MCP_DEVICE',
  'PLAYWRIGHT_MCP_MOBILE',
  'PLAYWRIGHT_MCP_CDP_ENDPOINT',
  'PLAYWRIGHT_MCP_EXTENSION',
  'PLAYWRIGHT_MCP_ENDPOINT',
];

const DEVICE_FLAGS = ['--device', '--mobile', '--cdp-endpoint', '--extension', '--endpoint'];

export function resolveBrowserEnv<T extends string | undefined>(
  env: Record<string, T>,
  args: string[] = []
): Record<string, T | string> {
  const chosen =
    DEVICE_CHOICES.some((key) => env[key] !== undefined) ||
    args.some((arg) => DEVICE_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
  return { ...(chosen ? {} : RETINA_BROWSER_ENV), ...env, ...HEADLESS_BROWSER_ENV };
}

const TRANSPORTS = new Set<McpTransport>(['stdio', 'http', 'sse']);

const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readTrimmedText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readTexts(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readTextMap(value: unknown) {
  if (!isFields(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function resolveTransport(declared: unknown, url: string | null): McpTransport {
  if (TRANSPORTS.has(declared as McpTransport)) return declared as McpTransport;
  if (declared === 'streamable-http' || declared === 'streamable_http') return 'http';
  return url ? 'http' : 'stdio';
}

export function parseMcpEntry(value: unknown): McpDefinition | null {
  if (!isFields(value)) return null;
  const url = readTrimmedText(value.url);
  const command = readTrimmedText(value.command);
  const transport = resolveTransport(value.type ?? value.transport, url);
  if (transport === 'stdio' ? !command : !url) return null;
  return {
    transport,
    command: transport === 'stdio' ? command : null,
    args: transport === 'stdio' ? readTexts(value.args) : [],
    env: readTextMap(value.env),
    cwd: readTrimmedText(value.cwd),
    url: transport === 'stdio' ? null : url,
    headers: readTextMap(value.headers ?? value.http_headers),
    bearerTokenEnv: readTrimmedText(value.bearer_token_env_var),
  };
}

export function readMcpServers(value: unknown) {
  if (!isFields(value)) return [];
  return Object.entries(value).flatMap(([name, entry]) => {
    const definition = parseMcpEntry(entry);
    return definition ? [{ name, definition }] : [];
  });
}

function expandText(text: string, env: Env) {
  return text.replace(VARIABLE, (_match, name: string, fallback?: string) => env[name] ?? fallback ?? '');
}

function expandMap(map: Record<string, string>, env: Env) {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, expandText(value, env)]));
}

export function expandDefinition(definition: McpDefinition, env: Env): McpDefinition {
  const token = definition.bearerTokenEnv ? env[definition.bearerTokenEnv] : undefined;
  const headers = expandMap(definition.headers, env);
  return {
    ...definition,
    command: definition.command === null ? null : expandText(definition.command, env),
    args: definition.args.map((arg) => expandText(arg, env)),
    env: expandMap(definition.env, env),
    url: definition.url === null ? null : expandText(definition.url, env),
    headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
  };
}
