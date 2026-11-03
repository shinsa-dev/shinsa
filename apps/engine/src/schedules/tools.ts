import { DomainError, type ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { SurfaceHookSecrets } from '../surface/index.ts';
import type { ScheduleToolCall, ScheduleToolContext } from './schema.ts';
import {
  ScheduleSecretFailed,
  type ScheduleToolRun,
  ScheduleToolRefused,
  type ScheduleToolsHandle,
} from './tools/schema.ts';
import { createScheduleTools } from './tools/service.ts';

export type { ScheduleToolCall, ScheduleToolContext } from './schema.ts';

function secretFailed(error: unknown) {
  return new ScheduleSecretFailed({ message: describeError(error) });
}

function resolveTools(context: ScheduleToolContext): ScheduleToolsHandle {
  const { secrets } = context;
  return createScheduleTools({
    now: Effect.sync(context.now),
    timeZone: context.timeZone,
    baseUrl: Effect.sync(context.baseUrl),
    hookUrl: (scheduleId, token) => Effect.sync(() => context.hookUrl(scheduleId, token)),
    selectHook: (scheduleId) => Effect.sync(() => secrets.selectHook(scheduleId)),
    hasRef: (ref) => Effect.sync(() => secrets.hasRef(ref)),
    takeSecret: (ref, taskId) =>
      Effect.try({ try: () => secrets.removeRef(ref, taskId), catch: secretFailed }),
    writeHookSecret: (scheduleId, secret) =>
      Effect.try({ try: () => secrets.writeHookSecret(scheduleId, secret), catch: secretFailed }),
  });
}

function resolveRun(call: ScheduleToolCall): ScheduleToolRun {
  return {
    runId: call.runId,
    attemptId: call.attemptId,
    state: Effect.sync(call.state),
    dispatch: (command) =>
      Effect.tryPromise({
        try: () => call.dispatch(command),
        catch: (error) =>
          error instanceof DomainError ? error : new ScheduleToolRefused({ message: describeError(error) }),
      }),
  };
}

export function findHookUrl(context: ScheduleToolContext, scheduleId: string) {
  return edgeRuntime.runSync(resolveTools(context).findHookUrl(scheduleId));
}

export function createHookSecrets(
  context: ScheduleToolContext,
  state: () => ShinsaState,
  taskId: string
): SurfaceHookSecrets {
  const tools = resolveTools(context);
  return {
    assertSecret: (scheduleId, ref) =>
      edgeRuntime.runSync(tools.assertSigningSecret(scheduleId, ref, 'signature_secret_ref')),
    writeSecret: (scheduleId, ref) =>
      edgeRuntime.runSync(tools.writeScheduleSecret(state(), scheduleId, ref, taskId)),
  };
}

export function handleScheduleTool(
  name: string,
  input: Record<string, unknown>,
  call: ScheduleToolCall,
  context: ScheduleToolContext
): Promise<string> | null {
  const tool = resolveTools(context).handle(name, input, resolveRun(call));
  return tool ? edgeRuntime.runPromise(tool) : null;
}
