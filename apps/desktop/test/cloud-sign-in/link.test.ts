import { describe, expect, it } from 'bun:test';
import { Option } from 'effect';
import {
  parseSignInReturn,
  resolveSignInFailurePath,
  resolveSignInUrl,
} from '../../src/cloud-sign-in/link.ts';
import type { SignInReturn } from '../../src/cloud-sign-in/schema.ts';

describe('the sign-in link', () => {
  it('reads the code or the error Shinsa Cloud sends back', () => {
    expect(parseSignInReturn('shinsa://signed-in?code=abc')).toEqual(
      Option.some({ _tag: 'Code', code: 'abc' })
    );
    expect(parseSignInReturn('SHINSA://Signed-In?error=sign_in_failed')).toEqual(
      Option.some({ _tag: 'Failed', code: 'sign_in_failed' })
    );
  });

  it('turns an empty, oversized or odd answer into a failed sign-in', () => {
    const failed = Option.some<SignInReturn>({ _tag: 'Failed', code: 'sign_in_failed' });
    expect(parseSignInReturn('shinsa://signed-in')).toEqual(failed);
    expect(parseSignInReturn('shinsa://signed-in?code=')).toEqual(failed);
    expect(parseSignInReturn(`shinsa://signed-in?code=${'a'.repeat(201)}`)).toEqual(failed);
    expect(parseSignInReturn('shinsa://signed-in?error=<script>')).toEqual(failed);
  });

  it('leaves every other link to the page', () => {
    expect(parseSignInReturn('shinsa://task/LOC-4')).toEqual(Option.none());
    expect(parseSignInReturn('https://signed-in?code=abc')).toEqual(Option.none());
    expect(parseSignInReturn('not a link')).toEqual(Option.none());
  });

  it('asks Shinsa Cloud for a native sign-in that comes back to the app', () => {
    const url = new URL(resolveSignInUrl('https://app.shinsa.dev', 'c'.repeat(43)));
    expect(url.origin + url.pathname).toBe('https://app.shinsa.dev/__remote/sign-in');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client: 'native',
      redirect: 'shinsa://signed-in',
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
    });
  });

  it('lands a failure on the page that explains it', () => {
    expect(resolveSignInFailurePath('sign_in_expired')).toBe('/?sign_in_error=sign_in_expired');
  });
});
