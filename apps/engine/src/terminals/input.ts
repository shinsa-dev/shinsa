import {
  DomainError,
  isServiceEnvKey,
  isServicePreviewUrl,
  SERVICE_LIMITS,
  SERVICE_PORT_VARIABLE,
  type ServiceDefinition,
  type TerminalPlace,
} from '@shinsa/core';
import { isFolder } from '../files/paths.ts';
import { PATH_LIMIT } from '../files/schema.ts';
import type { JsonObject } from '../http/schema.ts';
import { resolveServicePlace } from './places.ts';
import type { ServiceInput } from './schema.ts';

export function readText(body: JsonObject, field: string, limit: number) {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > limit)
    throw new DomainError({
      code: 'body_invalid',
      message: `Send “${field}” as text of at most ${limit} characters.`,
    });
  return value;
}

export function readOptionalText(body: JsonObject, field: string, limit: number) {
  return body[field] === undefined || body[field] === null ? null : readText(body, field, limit);
}

function readEnv(body: JsonObject) {
  const value = body.env ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DomainError({ code: 'body_invalid', message: 'Send “env” as an object of names and values.' });
  const entries = Object.entries(value);
  if (entries.length > SERVICE_LIMITS.envKeys)
    throw new DomainError({
      code: 'body_invalid',
      message: `A service takes ${SERVICE_LIMITS.envKeys} variables at most.`,
    });
  const env: Record<string, string> = {};
  for (const [key, each] of entries) {
    if (!isServiceEnvKey(key))
      throw new DomainError({ code: 'service_env_invalid', message: `“${key}” is not a variable name.` });
    if (typeof each !== 'string' || each.length > SERVICE_LIMITS.envValue)
      throw new DomainError({ code: 'service_env_invalid', message: `The value of “${key}” is too long.` });
    env[key] = each;
  }
  return env;
}

function readPreviewUrl(body: JsonObject) {
  const url = readOptionalText(body, 'previewUrl', SERVICE_LIMITS.previewUrl)?.trim() || null;
  if (url !== null && !isServicePreviewUrl(url))
    throw new DomainError({
      code: 'service_preview_invalid',
      message: 'Put {port} in an http or https URL.',
    });
  return url;
}

function readPortVariable(body: JsonObject) {
  const name = readOptionalText(body, 'portVariable', 200)?.trim() || SERVICE_PORT_VARIABLE;
  if (!isServiceEnvKey(name))
    throw new DomainError({ code: 'service_env_invalid', message: `“${name}” is not a variable name.` });
  return name;
}

export function readServiceInput(
  body: JsonObject,
  others: ServiceDefinition[],
  places: TerminalPlace[],
  home: string
): ServiceInput {
  const name = readText(body, 'name', SERVICE_LIMITS.name).trim();
  if (!name) throw new DomainError({ code: 'body_invalid', message: 'Give the service a name.' });
  if (others.some((service) => service.name.toLowerCase() === name.toLowerCase()))
    throw new DomainError({ code: 'service_name_taken', message: 'Another service has that name.' });
  const cwd = readText(body, 'path', PATH_LIMIT);
  if (!resolveServicePlace(places, cwd, home))
    throw new DomainError({ code: 'service_place_invalid', message: 'Pick one of the project’s folders.' });
  if (!isFolder(cwd))
    throw new DomainError({ code: 'terminal_place_missing', message: 'That folder is not there anymore.' });
  const command = readText(body, 'command', SERVICE_LIMITS.command).trim();
  if (!command)
    throw new DomainError({ code: 'body_invalid', message: 'Give the service a command to run.' });
  return {
    name,
    cwd,
    command,
    env: readEnv(body),
    previewUrl: readPreviewUrl(body),
    portVariable: readPortVariable(body),
  };
}

export function readServiceBatch(
  body: JsonObject,
  others: ServiceDefinition[],
  places: TerminalPlace[],
  home: string
): ServiceInput[] {
  const list = body.services;
  if (!Array.isArray(list) || list.length === 0 || list.length > SERVICE_LIMITS.services)
    throw new DomainError({
      code: 'body_invalid',
      message: `Send “services” as a list of 1 to ${SERVICE_LIMITS.services} services.`,
    });
  const inputs: ServiceInput[] = [];
  for (const each of list) {
    if (!each || typeof each !== 'object' || Array.isArray(each))
      throw new DomainError({ code: 'body_invalid', message: 'Send each service as an object.' });
    const taken = [...others, ...inputs.map((input) => ({ ...input, id: '', projectId: '' }))];
    inputs.push(readServiceInput(each as JsonObject, taken, places, home));
  }
  return inputs;
}

export function readServiceIds(body: JsonObject) {
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > SERVICE_LIMITS.services ||
    ids.some((id) => typeof id !== 'string')
  )
    throw new DomainError({
      code: 'body_invalid',
      message: `Send “ids” as a list of 1 to ${SERVICE_LIMITS.services} service ids.`,
    });
  return [...new Set(ids as string[])];
}
