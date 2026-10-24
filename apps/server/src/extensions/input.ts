import { DomainError, type ExtensionScope, MCP_NAME_PATTERN, type ShinsaState } from '@shinsa/core';
import { redactSecrets } from '../log/index.ts';
import { isFields, type McpDefinition } from './definitions.ts';
import { parseScope } from './store.ts';

const RESERVED_NAMES = new Set(['shinsa']);

const SECRET_NAME = /key|token|secret|passw|auth|credential|signature/i;

const REDACTED = '***';

function parseTextMap(value: unknown, field: string) {
  if (value === undefined || value === null) return {};
  if (!isFields(value) || !Object.values(value).every((item) => typeof item === 'string')) {
    throw new DomainError('server_invalid', `${field} must map names to text.`);
  }
  return value as Record<string, string>;
}

function parseArgs(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new DomainError('server_invalid', 'The arguments must be a list of text.');
  }
  return value;
}

function keepSaved(next: Record<string, string>, saved: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(next).map(([key, value]) => [key, value === '' ? (saved[key] ?? '') : value])
  );
}

function isWebUrl(text: string) {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSecretFlag(arg: string | undefined) {
  return arg?.startsWith('-') === true && !arg.includes('=') && SECRET_NAME.test(arg);
}

export function redactServerUrl(text: string | null) {
  if (text === null) return null;
  if (!URL.canParse(text)) return redactSecrets(text);
  const url = new URL(text);
  const secrets = [...url.searchParams.keys()].filter((name) => SECRET_NAME.test(name));
  if (secrets.length === 0 && !url.username && !url.password) return redactSecrets(text);
  for (const name of secrets) url.searchParams.set(name, REDACTED);
  if (url.username) url.username = REDACTED;
  if (url.password) url.password = REDACTED;
  return url.toString();
}

export function redactServerArgs(args: string[]) {
  return args.map((arg, index) => {
    const flag = /^(-[^=]+)=/.exec(arg);
    if (flag && isSecretFlag(flag[1])) return `${flag[1]}=${REDACTED}`;
    if (!arg.startsWith('-') && isSecretFlag(args[index - 1])) return REDACTED;
    return redactSecrets(arg);
  });
}

function restoreArgs(args: string[], saved: McpDefinition | null) {
  if (!saved) return args;
  const shown = redactServerArgs(saved.args);
  return args.map((arg, index) => (arg === shown[index] ? (saved.args[index] ?? arg) : arg));
}

function restoreUrl(url: string, saved: McpDefinition | null) {
  if (!saved?.url) return url;
  return url === redactServerUrl(saved.url) ? saved.url : url;
}

export function parseServerDefinition(
  fields: Record<string, unknown>,
  saved: McpDefinition | null
): McpDefinition {
  const transport = fields.transport;
  if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse') {
    throw new DomainError('server_invalid', 'Pick how Shinsa reaches the server: a command, HTTP or SSE.');
  }
  const env = keepSaved(parseTextMap(fields.env, 'The environment'), saved?.env ?? {});
  const headers = keepSaved(parseTextMap(fields.headers, 'The headers'), saved?.headers ?? {});
  if (transport === 'stdio') {
    const command = typeof fields.command === 'string' ? fields.command.trim() : '';
    if (!command) throw new DomainError('server_invalid', 'Give the command that starts the server.');
    return {
      transport,
      command,
      args: restoreArgs(parseArgs(fields.args), saved),
      env,
      cwd: saved?.cwd ?? null,
      url: null,
      headers: {},
      bearerTokenEnv: null,
    };
  }
  const url = restoreUrl(typeof fields.url === 'string' ? fields.url.trim() : '', saved);
  if (!isWebUrl(url)) throw new DomainError('server_invalid', 'Give the server’s http or https address.');
  return {
    transport,
    command: null,
    args: [],
    env: {},
    cwd: null,
    url,
    headers,
    bearerTokenEnv: saved?.bearerTokenEnv ?? null,
  };
}

export function parseServerName(value: unknown, isTaken: (name: string) => boolean) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!MCP_NAME_PATTERN.test(name)) {
    throw new DomainError(
      'server_name_invalid',
      'Name it with letters, digits, dashes or underscores, at most 64 characters.'
    );
  }
  if (RESERVED_NAMES.has(name))
    throw new DomainError('server_name_invalid', 'The name shinsa is Shinsa’s own.');
  if (isTaken(name)) throw new DomainError('server_name_taken', `Shinsa already has a server named ${name}.`);
  return name;
}

export function parseServerScope(value: unknown, state: ShinsaState): ExtensionScope {
  const scope = parseScope(value);
  if (!scope)
    throw new DomainError('scope_invalid', 'Use it everywhere, in one project or in one repository.');
  if (scope.kind === 'project' && !state.projects[scope.project]) {
    throw new DomainError('scope_invalid', 'There is no project with that id.');
  }
  if (scope.kind === 'repo' && !Object.values(state.repos).some((repo) => repo.path === scope.path)) {
    throw new DomainError('scope_invalid', 'Shinsa has not worked in that repository yet.');
  }
  return scope;
}
