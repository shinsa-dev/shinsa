import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  BROWSER_SIGN_IN_LIMITS,
  isLocalSignInUrl,
  resolveBrowserSignInReply,
  resolveBrowserSignInResumePrompt,
  resolveSignInSite,
  type SignInCheck,
  validateBrowserSignInRequest,
} from '../../src/browser/index.ts';
import type { Gate } from '../../src/domain/index.ts';

type ReplyGate = Pick<Gate, 'status' | 'decision' | 'supersededBy' | 'browserSignIn'>;

const ON_SITE: SignInCheck = { kind: 'landed', url: 'https://vercel.com/dashboard' };
const UNCHECKED: SignInCheck = { kind: 'unchecked', reason: 'timeout' };

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

describe('a local sign-in address', () => {
  test('is a loopback host or any address with a port', () => {
    for (const url of [
      'http://localhost:64892/',
      'http://127.0.0.1/login',
      'http://[::1]/',
      'http://web.localhost/',
      'https://staging.example.com:8443/sign-in',
    ]) {
      expect(isLocalSignInUrl(url), url).toBe(true);
    }
  });

  test('is not a public site on its default port, or anything that is not a web page', () => {
    for (const url of ['https://vercel.com/login', 'https://localhost.example.com/', 'localhost:3000', '']) {
      expect(isLocalSignInUrl(url), url).toBe(false);
    }
  });
});

describe('the reply the waiting agent gets', () => {
  const approved: ReplyGate = { ...OPEN, status: 'answered', decision: 'approve' };

  test('says the browser is signed in when the page stays on the site', () => {
    expect(resolveBrowserSignInReply(approved, ON_SITE)).toBe(
      'The human signed your project’s shared browser in to vercel.com: https://vercel.com/login now opens https://vercel.com/dashboard. Open the page again and carry on. It stays signed in for later tasks of this project too.'
    );
  });

  test('says it is still not signed in, and where it landed, when the page goes to another origin', () => {
    const local: ReplyGate = {
      ...approved,
      browserSignIn: { url: 'http://localhost:64892/', site: 'localhost' },
    };
    const landed =
      'https://expansive-singer-38.authkit.app/?redirect_uri=http://localhost:64892/auth/callback';
    const reply = resolveBrowserSignInReply(local, { kind: 'landed', url: landed });
    expect(reply).toStartWith(
      `The shared browser is still not signed in to localhost: http://localhost:64892/ sends it to ${landed}.`
    );
    expect(reply).toContain('Copying a sign-in carries cookies only');
    expect(reply).toContain('Open sign-in window');
    expect(resolveBrowserSignInReply(local, { kind: 'landed', url: 'http://localhost:3000/' })).toStartWith(
      'The shared browser is still not signed in to localhost:'
    );
  });

  test('says it is not signed in when the page lands on something that is not a web page', () => {
    expect(resolveBrowserSignInReply(approved, { kind: 'landed', url: 'about:blank' })).toStartWith(
      'The shared browser is still not signed in to vercel.com:'
    );
  });

  test('says why it could not check, for each reason', () => {
    expect(resolveBrowserSignInReply(approved, UNCHECKED)).toBe(
      'The human says they signed your project’s shared browser in to vercel.com, but I could not check it: the page did not load in time. Open the page again; if it still asks you to sign in, ask again with `request_browser_sign_in`.'
    );
    for (const [reason, words] of [
      ['not_installed', 'Google Chrome is not installed'],
      ['launch_failed', 'the shared browser did not start'],
      ['signing_in', 'the sign-in window was still open'],
      ['failed', 'the shared browser did not answer'],
    ] as const) {
      expect(resolveBrowserSignInReply(approved, { kind: 'unchecked', reason })).toContain(
        `check it: ${words}.`
      );
    }
  });

  test('says to carry on without it when the human skips it', () => {
    expect(resolveBrowserSignInReply({ ...OPEN, status: 'answered', decision: 'reject' }, ON_SITE)).toBe(
      'The human skipped signing in to vercel.com. Carry on without it, and say in your hand-over what you could not check.'
    );
  });

  test('passes on what the human wrote instead, or says the request was withdrawn', () => {
    expect(
      resolveBrowserSignInReply(
        { ...OPEN, status: 'withdrawn', supersededBy: 'Use the test user.' },
        UNCHECKED
      )
    ).toContain('The human wrote this instead: Use the test user.');
    const withdrawn = 'The sign-in request was withdrawn. Carry on without signing in, or ask again later.';
    expect(resolveBrowserSignInReply({ ...OPEN, status: 'withdrawn' }, UNCHECKED)).toBe(withdrawn);
    expect(resolveBrowserSignInReply(OPEN, UNCHECKED)).toBe(withdrawn);
    expect(resolveBrowserSignInReply(undefined, UNCHECKED)).toBe(withdrawn);
  });

  test('a resumed session is reminded what it asked for, even without the site recorded', () => {
    expect(resolveBrowserSignInResumePrompt(approved, ON_SITE)).toMatch(
      /^You asked the human to sign your project’s shared browser in to vercel\.com\.\n\nThe human signed/
    );
    expect(
      resolveBrowserSignInResumePrompt(
        { ...OPEN, browserSignIn: null, status: 'answered', decision: 'reject' },
        UNCHECKED
      )
    ).toContain('skipped signing in to the site.');
    expect(resolveBrowserSignInResumePrompt({ ...approved, browserSignIn: null }, ON_SITE)).toContain(
      'still not signed in to the site'
    );
  });
});
