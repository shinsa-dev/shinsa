import { DomainError, type ExtensionScope, MCP_NAME_PATTERN, type ShinsaState } from '@shinsa/core';
import { Result } from 'effect';
import { redactSecrets } from '../log/index.ts';
import { isFields, type McpDefinition } from './definitions.ts';

const RESERVED_NAMES = new Set(['shinsa']);

const SECRET_NAME = /key|token|secret|passw|auth|credential|signature/i;

const REDACTED = '***';

function refuse(code: string, message: string): Result.Result<never, DomainError> {
  return Result.fail(new DomainError({ code, message }));
}

function parseTextMap(value: unknown, field: string): Result.Result<Record<string, string>, DomainError> {
  if (value === undefined || value === null) return Result.succeed({});
  if (!isFields(value) || !Object.values(value).every((item) => typeof item === 'string'))
    return refuse('server_invalid', `${field} must map names to text.`);
  return Result.succeed(value as Record<string, string>);
}

function parseArgs(value: unknown): Result.Result<string[], DomainError> {
  if (value === undefined || value === null) return Result.succeed([]);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    return refuse('server_invalid', 'The arguments must be a list of text.');
  return Result.succeed(value);
}

function keepSaved(next: Record<string, string>, saved: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(next).map(([key, value]) => [key, value === '' ? (saved[key] ?? '') : value])
  );
}

function isWebUrl(text: string) {
  return Result.try(() => new URL(text)).pipe(
    Result.match({
      onFailure: () => false,
      onSuccess: (url) => url.protocol === 'http:' || url.protocol === 'https:',
    })
  );
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
): Result.Result<McpDefinition, DomainError> {
  return Result.gen(function* () {
    const transport = fields.transport;
    if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse')
      return yield* refuse('server_invalid', 'Pick a command, HTTP or SSE.');
    const env = keepSaved(yield* parseTextMap(fields.env, 'The environment'), saved?.env ?? {});
    const headers = keepSaved(yield* parseTextMap(fields.headers, 'The headers'), saved?.headers ?? {});
    if (transport === 'stdio') {
      const command = typeof fields.command === 'string' ? fields.command.trim() : '';
      if (!command) return yield* refuse('server_invalid', 'Give the command that starts the MCP.');
      const stdio: McpDefinition = {
        transport,
        command,
        args: restoreArgs(yield* parseArgs(fields.args), saved),
        env,
        cwd: saved?.cwd ?? null,
        url: null,
        headers: {},
        bearerTokenEnv: null,
      };
      return stdio;
    }
    const url = restoreUrl(typeof fields.url === 'string' ? fields.url.trim() : '', saved);
    if (!isWebUrl(url)) return yield* refuse('server_invalid', 'Give the MCP’s http or https address.');
    const remote: McpDefinition = {
      transport,
      command: null,
      args: [],
      env: {},
      cwd: null,
      url,
      headers,
      bearerTokenEnv: saved?.bearerTokenEnv ?? null,
    };
    return remote;
  });
}

export function parseServerName(
  value: unknown,
  isTaken: (name: string) => boolean
): Result.Result<string, DomainError> {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!MCP_NAME_PATTERN.test(name))
    return refuse('server_name_invalid', 'Use up to 64 letters, digits, - or _.');
  if (RESERVED_NAMES.has(name)) return refuse('server_name_invalid', 'The name shinsa is Shinsa’s own.');
  if (isTaken(name)) return refuse('server_name_taken', `An MCP named ${name} exists.`);
  return Result.succeed(name);
}

export function parseServerScope(
  scope: ExtensionScope | null,
  state: ShinsaState
): Result.Result<ExtensionScope, DomainError> {
  if (!scope) return refuse('scope_invalid', 'Pick all, a project or a repository.');
  if (scope.kind === 'project' && !state.projects[scope.project])
    return refuse('scope_invalid', 'There is no project with that id.');
  if (scope.kind === 'repo' && !Object.values(state.repos).some((repo) => repo.path === scope.path))
    return refuse('scope_invalid', 'No agent has worked there yet.');
  return Result.succeed(scope);
}
