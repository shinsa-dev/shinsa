import type { GuestActor } from '@shinsa/core';
import {
  BodyTooLarge,
  ConnectRefused,
  ContentTypeInvalid,
  InspectReadOnly,
  LocalOnly,
  RequestFailed,
  RequestForbidden,
  RouteNotFound,
  ScopeRefused,
} from '@shinsa/core/engine-api/schema';
import { Context, Schema } from 'effect';
import type { HttpContext } from './server.ts';

export const REQUEST_VIAS = ['local', 'tunnel', 'channel'] as const;

export type RequestVia = (typeof REQUEST_VIAS)[number];

export interface RequestSourceShape {
  readonly via: RequestVia;
  readonly guest: GuestActor | null;
}

export const RequestSource = Context.Reference<RequestSourceShape>('shinsa/engine/http/RequestSource', {
  defaultValue: () => ({ via: 'local', guest: null }),
});

export type HttpServicesShape = HttpContext;

export const FIXED_FAILURES = {
  RouteNotFound,
  RequestForbidden,
  ContentTypeInvalid,
  BodyTooLarge,
  InspectReadOnly,
  LocalOnly,
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

export const BROWSER_ONLY = 'browser_only';
