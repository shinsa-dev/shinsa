import { Schema, SchemaTransformation } from 'effect';

interface RemoteFailureWire<Code extends string> {
  readonly code: Code;
  readonly status: number;
}

const WIRE_BY_TAG = new Map<string, RemoteFailureWire<string>>();

const RemoteFailure =
  <Self>() =>
  <const Tag extends string, const Code extends string>(tag: Tag, wire: RemoteFailureWire<Code>) => {
    WIRE_BY_TAG.set(tag, wire);
    const Base = Schema.TaggedError<Self>()(tag, { message: Schema.String }, { httpApiStatus: wire.status });
    const body = Schema.Struct({
      error: Schema.Struct({ code: Schema.Literal(wire.code), message: Schema.String }),
    });
    return Object.assign(Base, { tag, code: wire.code, status: wire.status, body });
  };

export class BodyInvalid extends RemoteFailure<BodyInvalid>()('BodyInvalid', {
  code: 'body_invalid',
  status: 400,
}) {}

export class BodyTooLarge extends RemoteFailure<BodyTooLarge>()('BodyTooLarge', {
  code: 'body_too_large',
  status: 413,
}) {}

export class ContentTypeInvalid extends RemoteFailure<ContentTypeInvalid>()('ContentTypeInvalid', {
  code: 'content_type_invalid',
  status: 415,
}) {}

export class Forbidden extends RemoteFailure<Forbidden>()('Forbidden', { code: 'forbidden', status: 403 }) {}

export class NotFound extends RemoteFailure<NotFound>()('NotFound', { code: 'not_found', status: 404 }) {}

export class MethodNotAllowed extends RemoteFailure<MethodNotAllowed>()('MethodNotAllowed', {
  code: 'method_not_allowed',
  status: 405,
}) {}

export class ServerError extends RemoteFailure<ServerError>()('ServerError', {
  code: 'server_error',
  status: 500,
}) {}

export class SignedOut extends RemoteFailure<SignedOut>()('SignedOut', { code: 'signed_out', status: 401 }) {}

export class Revoked extends RemoteFailure<Revoked>()('Revoked', { code: 'revoked', status: 401 }) {}

export class NotOwner extends RemoteFailure<NotOwner>()('NotOwner', { code: 'not_owner', status: 403 }) {}

export class OwnerCannotLeave extends RemoteFailure<OwnerCannotLeave>()('OwnerCannotLeave', {
  code: 'owner_cannot_leave',
  status: 409,
}) {}

export class InviteInvalid extends RemoteFailure<InviteInvalid>()('InviteInvalid', {
  code: 'invite_invalid',
  status: 404,
}) {}

export class HandoffInvalid extends RemoteFailure<HandoffInvalid>()('HandoffInvalid', {
  code: 'handoff_invalid',
  status: 404,
}) {}

export class MembersFull extends RemoteFailure<MembersFull>()('MembersFull', {
  code: 'members_full',
  status: 409,
}) {}

export class GuestsFull extends RemoteFailure<GuestsFull>()('GuestsFull', {
  code: 'guests_full',
  status: 409,
}) {}

export class TeamsFull extends RemoteFailure<TeamsFull>()('TeamsFull', { code: 'teams_full', status: 409 }) {}

export class InstancesFull extends RemoteFailure<InstancesFull>()('InstancesFull', {
  code: 'instances_full',
  status: 409,
}) {}

export class ServiceFull extends RemoteFailure<ServiceFull>()('ServiceFull', {
  code: 'service_full',
  status: 503,
}) {}

export class PairExpired extends RemoteFailure<PairExpired>()('PairExpired', {
  code: 'pair_expired',
  status: 404,
}) {}

export class PairClaimed extends RemoteFailure<PairClaimed>()('PairClaimed', {
  code: 'pair_claimed',
  status: 409,
}) {}

export class RateLimited extends RemoteFailure<RateLimited>()('RateLimited', {
  code: 'rate_limited',
  status: 429,
}) {}

export class SignInFailed extends RemoteFailure<SignInFailed>()('SignInFailed', {
  code: 'sign_in_failed',
  status: 400,
}) {}

export class InvalidRedirect extends RemoteFailure<InvalidRedirect>()('InvalidRedirect', {
  code: 'invalid_redirect',
  status: 400,
}) {}

export class InvalidChallenge extends RemoteFailure<InvalidChallenge>()('InvalidChallenge', {
  code: 'invalid_challenge',
  status: 400,
}) {}

export class UrlInvalid extends RemoteFailure<UrlInvalid>()('UrlInvalid', {
  code: 'url_invalid',
  status: 400,
}) {}

export class CloudflareFailed extends RemoteFailure<CloudflareFailed>()('CloudflareFailed', {
  code: 'cloudflare_failed',
  status: 502,
}) {}

export class SignatureInvalid extends RemoteFailure<SignatureInvalid>()('SignatureInvalid', {
  code: 'signature_invalid',
  status: 401,
}) {}

export class SlackDenied extends RemoteFailure<SlackDenied>()('SlackDenied', {
  code: 'slack_denied',
  status: 400,
}) {}

export class SlackExpired extends RemoteFailure<SlackExpired>()('SlackExpired', {
  code: 'slack_expired',
  status: 400,
}) {}

export class SlackFailed extends RemoteFailure<SlackFailed>()('SlackFailed', {
  code: 'slack_failed',
  status: 502,
}) {}

export class SlackBlocksRefused extends RemoteFailure<SlackBlocksRefused>()('SlackBlocksRefused', {
  code: 'slack_blocks_refused',
  status: 422,
}) {}

export class SlackNotInstalled extends RemoteFailure<SlackNotInstalled>()('SlackNotInstalled', {
  code: 'slack_not_installed',
  status: 410,
}) {}

export class ThreadNotForwarded extends RemoteFailure<ThreadNotForwarded>()('ThreadNotForwarded', {
  code: 'thread_not_forwarded',
  status: 403,
}) {}

export class SlackNotLinked extends RemoteFailure<SlackNotLinked>()('SlackNotLinked', {
  code: 'slack_not_linked',
  status: 403,
}) {}

export class PostNotYours extends RemoteFailure<PostNotYours>()('PostNotYours', {
  code: 'post_not_yours',
  status: 403,
}) {}

export const SERVER_ERROR_MESSAGE = 'Something went wrong on app.shinsa.dev. Try again.';

export function serializeRemoteFailure(error: { readonly _tag: string; readonly message: string }) {
  const wire = WIRE_BY_TAG.get(error._tag);
  if (!wire)
    return {
      status: ServerError.status,
      body: { error: { code: ServerError.code, message: SERVER_ERROR_MESSAGE } },
    };
  return { status: wire.status, body: { error: { code: wire.code, message: error.message } } };
}

interface RemoteFailureClass<Tag extends string, Code extends string> extends Schema.Codec<
  unknown,
  { readonly _tag: Tag; readonly message: string }
> {
  readonly tag: Tag;
  readonly code: Code;
  readonly status: number;
  readonly body: Schema.Codec<{ readonly error: { readonly code: Code; readonly message: string } }>;
}

export function resolveRemoteFailureWire<
  const Tag extends string,
  const Code extends string,
  Failure extends RemoteFailureClass<Tag, Code>,
>(failure: Failure & RemoteFailureClass<Tag, Code>) {
  return failure.body
    .pipe(
      Schema.decodeTo(
        failure,
        SchemaTransformation.transform({
          decode: (body) => ({ _tag: failure.tag, message: body.error.message }),
          encode: (error) => ({ error: { code: failure.code, message: error.message } }),
        })
      )
    )
    .annotate({ httpApiStatus: failure.status });
}
