import { REMOTE_NATIVE_CLIENT, REMOTE_PATHS } from '@shinsa/core';
import { Option, Schema } from 'effect';
import { isLinkProtocol } from '../deep-links/links.ts';
import {
  SIGN_IN_ERROR_PARAM,
  SIGN_IN_FAILURE,
  SIGN_IN_REDIRECT,
  SIGNED_IN_HOST,
  SignInReturn,
} from './schema.ts';

const decodeReturn = Schema.decodeUnknownOption(SignInReturn);

export function parseSignInReturn(raw: string): Option.Option<SignInReturn> {
  const url = URL.parse(raw);
  if (!url || !isLinkProtocol(url.protocol) || url.host.toLowerCase() !== SIGNED_IN_HOST)
    return Option.none();
  const code = url.searchParams.get('code');
  const answer =
    code === null ? { _tag: 'Failed', code: url.searchParams.get('error') } : { _tag: 'Code', code };
  return Option.some(
    Option.getOrElse(decodeReturn(answer), (): SignInReturn => ({
      _tag: 'Failed',
      code: SIGN_IN_FAILURE.failed,
    }))
  );
}

export function resolveSignInUrl(origin: string, challenge: string) {
  const url = new URL(REMOTE_PATHS.signIn, origin);
  url.searchParams.set('client', REMOTE_NATIVE_CLIENT);
  url.searchParams.set('redirect', SIGN_IN_REDIRECT);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export function resolveSignInFailurePath(code: string) {
  return `${REMOTE_PATHS.app}?${new URLSearchParams({ [SIGN_IN_ERROR_PARAM]: code })}`;
}
