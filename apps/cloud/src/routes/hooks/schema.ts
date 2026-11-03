import { InstanceId, REMOTE_PATHS } from '@shinsa/core';
import { Schema } from 'effect';

export const HOOK_BODY_LIMIT_BYTES = 1024 * 1024;

export const HOOK_ROUTE = `${REMOTE_PATHS.hooks}:instanceId/:scheduleId/:token` as const;

export const BODILESS_METHODS = new Set(['GET', 'HEAD']);

export const FORWARDED_AWAY = new Set(['cookie']);

const HookSegment = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/));

export const HookParams = Schema.Struct({
  instanceId: InstanceId,
  scheduleId: HookSegment,
  token: HookSegment,
});
