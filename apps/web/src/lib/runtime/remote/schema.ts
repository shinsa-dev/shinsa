import type { RemoteApi } from '@shinsa/core/remote/api';
import { Schema } from 'effect';
import type { HttpApiClient, HttpApiGroup } from 'effect/http-api';

export const CLOUD_UNREACHABLE_MESSAGE = 'Couldn’t reach Shinsa Cloud.';

export const CLOUD_ANSWER_UNREADABLE_MESSAGE = 'Shinsa Cloud sent an answer this page can’t read.';

export const CLOUD_FAILED_CODE = 'failed';

export const CLOUD_NOT_FOUND = { status: 404, code: 'not_found', message: 'No such endpoint.' } as const;

export const CloudErrorBody = Schema.Struct({
  error: Schema.Struct({
    code: Schema.optionalKey(Schema.String),
    message: Schema.optionalKey(Schema.String),
  }),
});

export class CloudUnreachable extends Schema.TaggedError<
  CloudUnreachable,
  { readonly brand: unique symbol }
>()('CloudUnreachable', { message: Schema.String }) {}

export class CloudRefused extends Schema.TaggedError<CloudRefused, { readonly brand: unique symbol }>()(
  'CloudRefused',
  { status: Schema.Number, code: Schema.String, message: Schema.String }
) {}

export class CloudAnswerInvalid extends Schema.TaggedError<
  CloudAnswerInvalid,
  { readonly brand: unique symbol }
>()('CloudAnswerInvalid', { message: Schema.String }) {}

export type CloudFailure = CloudUnreachable | CloudRefused | CloudAnswerInvalid;

type RemoteGroups = typeof RemoteApi extends { readonly groups: infer Groups } ? Groups : never;

export type RemotePageGroup<Id extends string> = HttpApiClient.Client.Group<
  HttpApiGroup.WithIdentifier<RemoteGroups[keyof RemoteGroups], Id>,
  CloudFailure,
  never
>;
