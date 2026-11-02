import { InstanceId, REMOTE_PATHS } from '@shinsa/core';
import { Schema } from 'effect';

export const HOOK_BODY_LIMIT_BYTES = 1024 * 1024;

export const HOOK_ROUTE = `${REMOTE_PATHS.hooks}:instanceId/:scheduleId/:token` as const;

export const BODILESS_METHODS = new Set(['GET', 'HEAD']);

export const FORWARDED_AWAY = new Set(['cookie']);

export const HookParams = Schema.Struct({
  instanceId: InstanceId,
  scheduleId: Schema.String,
  token: Schema.String,
});
