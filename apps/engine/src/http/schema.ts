import type { Changelog, ScopedActor } from '@shinsa/core';
import {
  BodyTooLarge,
  type FieldFailure,
  ConnectRefused,
  ContentTypeInvalid,
  InspectReadOnly,
  LocalOnly,
  NotMachineOwner,
  RequestFailed,
  RequestForbidden,
  RouteNotFound,
  ScopeRefused,
} from '@shinsa/core/engine-api/schema';
import { Context, type Effect, Schema } from 'effect';
import type { ModelSource } from '../agents/index.ts';
import type { ServerInstance } from '../instance/index.ts';
import type { CommandResult } from '../shell/index.ts';

const REQUEST_VIAS = ['local', 'tunnel', 'channel'] as const;

type RequestVia = (typeof REQUEST_VIAS)[number];

export interface RequestSourceShape {
  readonly via: RequestVia;
  readonly guest: ScopedActor | null;
  readonly userId: string | null;
}

export const RequestSource = Context.Reference<RequestSourceShape>('shinsa/engine/http/RequestSource', {
  defaultValue: () => ({ via: 'local', guest: null, userId: null }),
});

export const PORT_TAKEN = 'EADDRINUSE';

export class PortInUse extends Schema.TaggedError<PortInUse, { readonly brand: unique symbol }>()(
  'PortInUse',
  {
    message: Schema.String,
  }
) {}

export type JsonObject = Record<string, unknown>;

export type Launcher = (command: string[], cwd: string) => Effect.Effect<CommandResult>;

export class EngineModels extends Context.Service<EngineModels, ModelSource>()(
  'shinsa/engine/http/EngineModels'
) {}

export const ServedInstance = Context.Reference<ServerInstance | null>('shinsa/engine/http/ServedInstance', {
  defaultValue: () => null,
});

export const ServedChangelog = Context.Reference<Changelog | null>('shinsa/engine/http/ServedChangelog', {
  defaultValue: () => null,
});

export const CommandLauncher = Context.Reference<Launcher | null>('shinsa/engine/http/CommandLauncher', {
  defaultValue: () => null,
});

export const FIXED_FAILURES = {
  RouteNotFound,
  RequestForbidden,
  ContentTypeInvalid,
  BodyTooLarge,
  InspectReadOnly,
  LocalOnly,
  NotMachineOwner,
  ScopeRefused,
  ConnectRefused,
} as const;

export const IngressFailure = Schema.Union([
  RouteNotFound,
  RequestForbidden,
  ContentTypeInvalid,
  BodyTooLarge,
  InspectReadOnly,
  LocalOnly,
  NotMachineOwner,
  ScopeRefused,
  ConnectRefused,
  RequestFailed,
]);

export type IngressFailure = typeof IngressFailure.Type;

export const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

export const BODY_INVALID = 'body_invalid';

export const BODY_NOT_JSON = 'The request body is not valid JSON.';

export const BODY_NOT_OBJECT = 'The request body must be an object.';

export const REQUEST_FAILED = 'request_failed';

export const PROJECT_ID_LIMIT = 200;

export const PROJECT_GONE: FieldFailure = {
  code: 'project_not_found',
  message: 'That project is not there anymore.',
};

export const BROWSER_ONLY = 'browser_only';
