import type { McpTransport } from '@shinsa/core';
import { Option, Predicate, Schema } from 'effect';
import { type Env, type McpDefinition, Fields, McpEntry } from './schema.ts';

export type { Env } from './schema.ts';
export type { McpDefinition };

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

const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

const decodeEntry = Schema.decodeUnknownOption(McpEntry);

const decodeEntries = Schema.decodeUnknownOption(Fields);

export const isFields = Schema.is(Fields);

const DECLARED_TRANSPORTS: Record<string, McpTransport> = {
  stdio: 'stdio',
  http: 'http',
  sse: 'sse',
  'streamable-http': 'http',
  streamable_http: 'http',
};

function readTrimmedText(value: string | undefined) {
  return value?.trim() || null;
}

function readTextMap(value: unknown): Record<string, string> {
  return Option.match(decodeEntries(value), {
    onNone: () => ({}),
    onSome: (fields) =>
      Object.fromEntries(
        Object.entries(fields).filter((entry): entry is [string, string] => Predicate.isString(entry[1]))
      ),
  });
}

function resolveTransport(entry: McpEntry, url: string | null): McpTransport {
  const declared = entry.type ?? entry.transport;
  const known = Predicate.isString(declared) ? DECLARED_TRANSPORTS[declared] : undefined;
  return known ?? (url ? 'http' : 'stdio');
}

function resolveDefinition(entry: McpEntry): McpDefinition | null {
  const url = readTrimmedText(entry.url);
  const command = readTrimmedText(entry.command);
  const transport = resolveTransport(entry, url);
  if (transport === 'stdio' ? !command : !url) return null;
  return {
    transport,
    command: transport === 'stdio' ? command : null,
    args: transport === 'stdio' ? [...(entry.args ?? [])] : [],
    env: { ...entry.env },
    cwd: readTrimmedText(entry.cwd),
    url: transport === 'stdio' ? null : url,
    headers: readTextMap(entry.headers ?? entry.http_headers),
    bearerTokenEnv: readTrimmedText(entry.bearer_token_env_var),
  };
}

export function parseMcpEntry(value: unknown): McpDefinition | null {
  return Option.getOrNull(Option.flatMapNullishOr(decodeEntry(value), resolveDefinition));
}

export function parseStoredDefinition(value: unknown): McpDefinition | null {
  return Option.getOrNull(
    Option.flatMapNullishOr(decodeEntry(value), (entry) => {
      const definition = resolveDefinition(entry);
      if (!definition) return null;
      return {
        ...definition,
        bearerTokenEnv: definition.bearerTokenEnv ?? readTrimmedText(entry.bearerTokenEnv),
      };
    })
  );
}

export function readMcpServers(value: unknown) {
  return Object.entries(Option.getOrElse(decodeEntries(value), () => ({}))).flatMap(([name, entry]) => {
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
