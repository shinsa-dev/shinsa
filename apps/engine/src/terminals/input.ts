import {
  DomainError,
  isServiceEnvKey,
  isServicePreviewUrl,
  SERVICE_LIMITS,
  SERVICE_PORT_VARIABLE,
  type ServiceDefinition,
  type TerminalPlace,
} from '@shinsa/core';
import { Result } from 'effect';
import { PATH_LIMIT } from '../files/schema.ts';
import type { JsonObject } from '../http/schema.ts';
import { resolveServicePlace } from './places.ts';
import type { ServiceInput } from './schema.ts';

function refuse(code: string, message: string): Result.Result<never, DomainError> {
  return Result.fail(new DomainError({ code, message }));
}

export function readText(body: JsonObject, field: string, limit: number): Result.Result<string, DomainError> {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > limit)
    return refuse('body_invalid', `Send “${field}” as text of at most ${limit} characters.`);
  return Result.succeed(value);
}

export function readOptionalText(
  body: JsonObject,
  field: string,
  limit: number
): Result.Result<string | null, DomainError> {
  return body[field] === undefined || body[field] === null
    ? Result.succeed(null)
    : readText(body, field, limit);
}

function readEnv(body: JsonObject): Result.Result<Record<string, string>, DomainError> {
  const value = body.env ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return refuse('body_invalid', 'Send “env” as an object of names and values.');
  const entries = Object.entries(value);
  if (entries.length > SERVICE_LIMITS.envKeys)
    return refuse('body_invalid', `A service takes ${SERVICE_LIMITS.envKeys} variables at most.`);
  const env: Record<string, string> = {};
  for (const [key, each] of entries) {
    if (!isServiceEnvKey(key)) return refuse('service_env_invalid', `“${key}” is not a variable name.`);
    if (typeof each !== 'string' || each.length > SERVICE_LIMITS.envValue)
      return refuse('service_env_invalid', `The value of “${key}” is too long.`);
    env[key] = each;
  }
  return Result.succeed(env);
}

function readPreviewUrl(body: JsonObject) {
  return Result.flatMap(readOptionalText(body, 'previewUrl', SERVICE_LIMITS.previewUrl), (text) => {
    const url = text?.trim() || null;
    if (url !== null && !isServicePreviewUrl(url))
      return refuse('service_preview_invalid', 'Put {port} in an http or https URL.');
    return Result.succeed(url);
  });
}

function readPortVariable(body: JsonObject) {
  return Result.flatMap(readOptionalText(body, 'portVariable', 200), (text) => {
    const name = text?.trim() || SERVICE_PORT_VARIABLE;
    if (!isServiceEnvKey(name)) return refuse('service_env_invalid', `“${name}” is not a variable name.`);
    return Result.succeed(name);
  });
}

export function readServiceInput(
  body: JsonObject,
  others: ServiceDefinition[],
  places: TerminalPlace[],
  home: string
): Result.Result<ServiceInput, DomainError> {
  return Result.gen(function* () {
    const name = (yield* readText(body, 'name', SERVICE_LIMITS.name)).trim();
    if (!name) return yield* refuse('body_invalid', 'Give the service a name.');
    if (others.some((service) => service.name.toLowerCase() === name.toLowerCase()))
      return yield* refuse('service_name_taken', 'Another service has that name.');
    const cwd = yield* readText(body, 'path', PATH_LIMIT);
    if (!resolveServicePlace(places, cwd, home))
      return yield* refuse('service_place_invalid', 'Pick one of the project’s folders.');
    const command = (yield* readText(body, 'command', SERVICE_LIMITS.command)).trim();
    if (!command) return yield* refuse('body_invalid', 'Give the service a command to run.');
    const input: ServiceInput = {
      name,
      cwd,
      command,
      env: yield* readEnv(body),
      previewUrl: yield* readPreviewUrl(body),
      portVariable: yield* readPortVariable(body),
    };
    return input;
  });
}

export function readServiceBatch(
  body: JsonObject,
  others: ServiceDefinition[],
  places: TerminalPlace[],
  home: string
): Result.Result<ServiceInput[], DomainError> {
  return Result.gen(function* () {
    const list = body.services;
    if (!Array.isArray(list) || list.length === 0 || list.length > SERVICE_LIMITS.services)
      return yield* refuse(
        'body_invalid',
        `Send “services” as a list of 1 to ${SERVICE_LIMITS.services} services.`
      );
    const inputs: ServiceInput[] = [];
    for (const each of list) {
      if (!each || typeof each !== 'object' || Array.isArray(each))
        return yield* refuse('body_invalid', 'Send each service as an object.');
      const taken = [...others, ...inputs.map((input) => ({ ...input, id: '', projectId: '' }))];
      inputs.push(yield* readServiceInput(each as JsonObject, taken, places, home));
    }
    return inputs;
  });
}

export function readServiceIds(body: JsonObject): Result.Result<string[], DomainError> {
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > SERVICE_LIMITS.services ||
    ids.some((id) => typeof id !== 'string')
  )
    return refuse('body_invalid', `Send “ids” as a list of 1 to ${SERVICE_LIMITS.services} service ids.`);
  return Result.succeed([...new Set(ids as string[])]);
}
