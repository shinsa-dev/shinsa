import type { DomainError } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
import type { Shell } from '../../shell/service.ts';

export const SERVICE_MARKER = 'SHINSA_SERVICE';

export const SERVICE_CARRIED_ENV = [
  'SHINSA_HOME',
  'SHINSA_DATA_DIR',
  'XDG_CONFIG_HOME',
  'SHINSA_PORT',
  'SHINSA_HOST',
];

export class ServiceCommandFailed extends Schema.TaggedError<
  ServiceCommandFailed,
  { readonly brand: unique symbol }
>()('ServiceCommandFailed', { message: Schema.String }) {}

export interface ServiceResult {
  ok: boolean;
  output: string;
}

export type ServiceRunner = (args: string[]) => Effect.Effect<ServiceResult, never, Shell>;

export interface EngineService {
  manager: 'launchd' | 'systemd';
  revivesKilled: boolean;
  prepare: Effect.Effect<string | null, DomainError | ServiceCommandFailed, Shell>;
  assertInstalled: Effect.Effect<void, DomainError, Shell>;
  start: Effect.Effect<void, ServiceCommandFailed, Shell>;
  stop: Effect.Effect<void, ServiceCommandFailed, Shell>;
  kill: Effect.Effect<void, ServiceCommandFailed, Shell>;
  restart: Effect.Effect<void, ServiceCommandFailed, Shell>;
  kick: Effect.Effect<boolean, never, Shell>;
}
