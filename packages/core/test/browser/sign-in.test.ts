import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  BROWSER_SIGN_IN_LIMITS,
  resolveBrowserSignInReply,
  resolveBrowserSignInResumePrompt,
  resolveSignInSite,
  validateBrowserSignInRequest,
} from '../../src/browser/index.ts';
import type { Gate } from '../../src/domain/index.ts';

type ReplyGate = Pick<Gate, 'status' | 'decision' | 'supersededBy' | 'browserSignIn'>;

const OPEN: ReplyGate = {
  status: 'open',
  decision: null,
  supersededBy: null,
  browserSignIn: { url: 'https://vercel.com/login', site: 'vercel.com' },
};

describe('the site a sign-in page belongs to', () => {
  test('is the host of an http or https address, port and path left out', () => {
    expect(Option.getOrNull(resolveSignInSite('https://app.superwall.com/sign-in?next=/'))).toBe(
      'app.superwall.com'
    );
    expect(Option.getOrNull(resolveSignInSite('http://localhost:5181/login'))).toBe('localhost');
  });

  test('is none for anything that is not a web page', () => {
    for (const url of ['github.com', 'file:///tmp/a.html', 'mailto:a@b.co', 'chrome://settings', '']) {
      expect(Option.getOrNull(resolveSignInSite(url)), url).toBeNull();
    }
  });
});

describe('reading request_browser_sign_in', () => {
  test('takes a web address and a reason, trimmed', () => {
    expect(
      validateBrowserSignInRequest({ url: ' https://vercel.com/login ', reason: ' To see the deploy. ' })
    ).toEqual({
      ok: true,
      value: { url: 'https://vercel.com/login', reason: 'To see the deploy.' },
    });
  });

  test('names each field that is missing, too long or not a web page', () => {
    const result = validateBrowserSignInRequest({
      url: 'vercel.com/login',
      reason: 'r'.repeat(BROWSER_SIGN_IN_LIMITS.reason + 1),
    });
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.errors.join('\n');
    expect(errors).toContain(
      'url must be the full http or https address of the page that asks you to sign in.'
    );
    expect(errors).toContain('reason');
    expect(validateBrowserSignInRequest({}).ok).toBe(false);
  });
});

describe('the reply the waiting agent gets', () => {
  test('says the browser is signed in when the human says so', () => {
    expect(resolveBrowserSignInReply({ ...OPEN, status: 'answered', decision: 'approve' })).toBe(
      'The human signed your project’s shared browser in to vercel.com. Open the page again and carry on. It stays signed in for later tasks of this project too.'
    );
  });

  test('says to carry on without it when the human skips it', () => {
    expect(resolveBrowserSignInReply({ ...OPEN, status: 'answered', decision: 'reject' })).toBe(
      'The human skipped signing in to vercel.com. Carry on without it, and say in your hand-over what you could not check.'
    );
  });

  test('passes on what the human wrote instead, or says the request was withdrawn', () => {
    expect(
      resolveBrowserSignInReply({ ...OPEN, status: 'withdrawn', supersededBy: 'Use the test user.' })
    ).toContain('The human wrote this instead: Use the test user.');
    const withdrawn = 'The sign-in request was withdrawn. Carry on without signing in, or ask again later.';
    expect(resolveBrowserSignInReply({ ...OPEN, status: 'withdrawn' })).toBe(withdrawn);
    expect(resolveBrowserSignInReply(OPEN)).toBe(withdrawn);
    expect(resolveBrowserSignInReply(undefined)).toBe(withdrawn);
  });

  test('a resumed session is reminded what it asked for, even without the site recorded', () => {
    expect(resolveBrowserSignInResumePrompt({ ...OPEN, status: 'answered', decision: 'approve' })).toMatch(
      /^You asked the human to sign your project’s shared browser in to vercel\.com\.\n\nThe human signed/
    );
    expect(
      resolveBrowserSignInResumePrompt({
        ...OPEN,
        browserSignIn: null,
        status: 'answered',
        decision: 'reject',
      })
    ).toContain('skipped signing in to the site.');
  });
});
